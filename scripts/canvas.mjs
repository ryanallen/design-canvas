#!/usr/bin/env node
// A canvas for HTML prototypes: every prototype in a folder on one board, live, where they can be
// played, edited the way Figma edits a frame, and commented on.
//
//   node canvas.mjs build  <folder> [--layout <canvas.json>] [--out <canvas.html>] [--title <t>]
//                                   [--comments-from <file>] [--no-measure] [--accept]
//   node canvas.mjs serve  <folder> [the same] [--port 4410]
//   node canvas.mjs check  <folder> [--out <canvas.html>] [--shots <dir>]
//   node canvas.mjs accept <folder> <prototype.html>… [--out <canvas.html>]
//
// build   writes one self-contained canvas file (default <folder>/canvas.html): every prototype
//         and the page's own code inlined, so it opens from disk, fetches nothing, and shows every
//         comment, edit and board object saved in it. From disk it takes nothing new.
// serve   builds, then serves the canvas on localhost, where it takes comments, board objects and
//         edits: an edit is written into the prototype's own file at the offsets it touches and
//         recorded as an `edit` line in the canvas file.
// check   the gate: edits each kind through a served copy, undoes each, leaves and reads back a
//         comment, opens Play, and fails on any request off the machine. Writes nothing it keeps.
// accept  records that a prototype changed on purpose since its last canvas edit (its build
//         script now carries the edits), so build stops refusing it.
//
// The layout is a canvas.json beside the prototypes, or --layout: sections, groups and frames.
// With none, every prototype is laid out in one grid. A prototype whose screens are
// `<section class="screen-page" id="…">` is one frame per screen.
//
// Also imported: `buildCanvas(options)` and `serveCanvas(options)` take the same options as an
// object, for a skill that works its own layout out first.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { applyEdit, lockedFor, parse, tag } from './lib/html.mjs'
import { inlineFile } from './lib/inline.mjs'
import { writeFileAtomic } from './lib/write.mjs'
import { cropToOption } from './lib/crop.mjs'
import { launchChromium } from './lib/browser.mjs'
import { CANVAS_MARK, foldBoard, foldEvents, insertEvent, makeBoardEvent, makeEvent, parseEvents, parseLines, randomId, storedLines } from './lib/events.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const WIDTH = 1440
const MIN_H = 480
const MAX_H = 4800
const sha = (text) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 16)
const isCanvas = (f) => /^canvas(?:-[a-z0-9-]+)?\.html$/i.test(path.basename(f))

const isPrototype = (html) => /class="[^"]*\bscreen-page\b/.test(html)
const screensOf = (html) =>
  [...html.matchAll(/<section\b[^>]*class="[^"]*\bscreen-page\b[^"]*"[^>]*>/g)].map((m) => /\bid="([^"]+)"/.exec(m[0])?.[1]).filter(Boolean)
const labelOf = (file, hash) => (hash ? `${file.replace(/\.html$/, '')} · ${hash}` : file.replace(/\.html$/, ''))

/** Every prototype in a folder, as frames: one per file, or one per screen of a walkable one. */
export function framesFor(folder, files) {
  return files.flatMap((file) => {
    const html = fs.readFileSync(path.join(folder, file), 'utf8')
    if (!isPrototype(html)) return [{ file, hash: '', label: labelOf(file, '') }]
    const screens = screensOf(html)
    return screens.length ? screens.map((hash) => ({ file, hash, label: labelOf(file, hash) })) : [{ file, hash: '', label: labelOf(file, '') }]
  })
}

/** The layout as pages: `{ title, pages: [{ title, sections }] }`, or `{ title, sections }` as one page. */
function readLayout(folder, layoutPath, title) {
  if (layoutPath) {
    const layout = typeof layoutPath === 'object' ? layoutPath : JSON.parse(fs.readFileSync(layoutPath, 'utf8'))
    const name = title ?? layout.title ?? path.basename(path.resolve(folder))
    const pages = Array.isArray(layout.pages) ? layout.pages : [{ title: layout.pageTitle ?? 'Page 1', sections: layout.sections ?? [] }]
    return { title: name, comments: layout.comments ?? null, play: !!layout.play, links: Array.isArray(layout.links) ? layout.links : [], pages: pages.map((p, i) => ({ id: `p${i + 1}`, title: p.title ?? `Page ${i + 1}`, sections: p.sections ?? [] })) }
  }
  const own = path.join(folder, 'canvas.json')
  if (fs.existsSync(own)) return readLayout(folder, own, title)
  const files = prototypeFiles(folder)
  const name = title ?? path.basename(path.resolve(folder))
  // A folder with no prototypes is a whiteboard: one empty page for notes, shapes and arrows.
  if (!files.length) return { title: name, pages: [{ id: 'p1', title: 'Board', sections: [] }] }
  return { title: name, pages: [{ id: 'p1', title: 'Page 1', sections: [{ title: name, sub: `${files.length} prototype${files.length === 1 ? '' : 's'}`, groups: [{ kind: 'flat', frames: framesFor(folder, files) }] }] }] }
}
const prototypeFiles = (folder) => fs.readdirSync(folder).filter((f) => f.endsWith('.html') && !isCanvas(f) && !f.startsWith('.')).sort()

/** What the board needs to know of a prototype before it draws it: its levers, whether it reflows, whether it plays. */
function metaOf(html) {
  const levers = /<meta\s+name="canvas-levers"\s+content="([^"]*)"/i.exec(html)?.[1].split(',').map((s) => s.trim()).filter((s) => /^--[\w-]+$/.test(s)) ?? []
  const fluid = /<meta\s+name="canvas-fluid"/i.test(html)
  const play = /<script\b/i.test(html) || /<a\b[^>]*\bhref="(?:#[^"]+|[^":]+\.html(?:#[^"]*)?)"/i.test(html)
  return { levers, fluid, play }
}

async function measure(folder, frames, warnings) {
  let browser
  try {
    ;({ browser } = await launchChromium(folder))
  } catch (err) {
    warnings.push(`no browser to measure with, so every frame is drawn ${WIDTH} × 1000 (${err.message.split('\n')[0]})`)
    for (const f of frames) Object.assign(f, { w: WIDTH, h: 1000 })
    return
  }
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 1000 } })
  await page.route(/^https?:/, (route) => route.abort())
  for (const f of frames) {
    try {
      await page.setViewportSize({ width: WIDTH, height: 1000 })
      await page.goto(`${pathToFileURL(path.join(folder, f.file)).href}${f.hash ? `#${f.hash}` : ''}`, { waitUntil: 'load', timeout: 20000 })
      await page.evaluate(() => document.fonts?.ready)
      if (f.crop) {
        const cut = await page.evaluate(`(${cropToOption})(${JSON.stringify(f.crop)})`)
        if (!cut) throw new Error(`no option ${f.crop} column to cut`)
        f.w = Math.min(WIDTH, Math.max(MIN_H, cut.w))
        await page.setViewportSize({ width: f.w, height: MIN_H })
        const tall = await page.evaluate(() => (document.scrollingElement || document.documentElement).scrollHeight)
        f.h = Math.min(MAX_H, Math.max(MIN_H, Math.ceil(tall)))
        continue
      }
      const hgt = await page.evaluate((hash) => {
        const screen = hash && document.getElementById(hash)
        const doc = document.scrollingElement || document.documentElement
        if (screen) return Math.max(screen.getBoundingClientRect().bottom + window.scrollY, doc.scrollHeight)
        return doc.scrollHeight
      }, f.hash)
      f.h = Math.min(MAX_H, Math.max(MIN_H, Math.ceil(hgt)))
    } catch (err) {
      warnings.push(`${f.label} could not be measured (${err.message.split('\n')[0]}); drawn 1000 tall`)
      f.h = 1000
      f.w = WIDTH
    }
    f.w ??= WIDTH
  }
  await browser.close()
}

const scriptSafe = (js) => js.replace(/<!--/g, '<\\!--').replace(/<\/script/gi, '<\\/script')
const stripped = (file) =>
  fs
    .readFileSync(path.join(here, 'lib', file), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')
    .replace(/^export /gm, '')
    .replace(/^import .*$/gm, '')
// The page carries the event format and the edit engine, so a canvas opened from disk can edit
// its own folder with no server (runtime/local.js).
const library = () =>
  `${stripped('events.mjs')}\nconst canvasHtml = (() => {\n${stripped('html.mjs')}\nreturn { parse, tag, untag, applyEdit, lockedFor }\n})()\n`
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The canvas page: chrome, the payload, the runtime, and every stored line after it. */
// The page's own code, read and made script-safe once, and again only when one of its files
// changes on disk: a served canvas renders the page after every edit, comment and board change.
const PARTS = ['runtime/board.js', 'runtime/editor.js', 'runtime/panel.js', 'runtime/local.js', 'runtime/canvas.css', 'runtime/editor.css', 'runtime/shell.html', 'lib/events.mjs', 'lib/html.mjs']
let partsCache = null
function pageParts() {
  const stamp = PARTS.map((f) => fs.statSync(path.join(here, f)).mtimeMs).join(',')
  if (partsCache?.stamp === stamp) return partsCache
  const read = (f) => fs.readFileSync(path.join(here, 'runtime', f), 'utf8')
  partsCache = {
    stamp,
    runtime: scriptSafe(['board.js', 'editor.js', 'panel.js', 'local.js'].map(read).join('\n')),
    css: ['canvas.css', 'editor.css'].map(read).join('\n'),
    shell: read('shell.html'),
    library: scriptSafe(library()),
  }
  return partsCache
}

function renderPage(payload, lines) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  const { runtime, css, shell, library: lib } = pageParts()
  const frames = payload.pages.reduce((n, p) => n + p.sections.reduce((m, s) => m + s.groups.reduce((k, g) => k + g.frames.length, 0), 0), 0)
  return shell
    .replace(/__TITLE__/g, esc(payload.title))
    .replace(/__KEY__/g, esc(payload.key))
    .replace(/__MARK__/g, CANVAS_MARK)
    .replace('__SUB__', frames ? `${frames} screen${frames === 1 ? '' : 's'}` : 'Whiteboard')
    .replace('/*__CSS__*/', () => css)
    .replace('__DATA__', () => json)
    .replace('/*__LIBRARY__*/', () => lib)
    .replace('/*__RUNTIME__*/', () => runtime)
    .replace('<!--__LINES__-->', () => `${lines.join('\n')}${lines.length ? '\n' : ''}`)
}

const lastCarried = (lines, file) => {
  // The newest edit line for a file, and whether a later line says its change since was meant.
  const edits = lines.filter((l) => l.startsWith('<!-- edit ')).flatMap((l) => parseLines(l, 'edit')).filter((e) => e.file === file && e.sha)
  return edits[edits.length - 1] ?? null
}

/**
 * Build the canvas. Options: folder, layout (a path or an object), out, title, key,
 * commentsFrom, measure (default true), accept, quiet.
 */
export async function buildCanvas(options) {
  const folder = path.resolve(options.folder)
  const out = path.resolve(options.out ?? path.join(folder, 'canvas.html'))
  const warnings = []
  fs.mkdirSync(folder, { recursive: true })
  const layout = readLayout(folder, options.layout, options.title)
  const sections = layout.pages.flatMap((p) => p.sections)
  const frames = sections.flatMap((s) => s.groups.flatMap((g) => g.frames))
  for (const f of frames) if (!fs.existsSync(path.join(folder, f.file))) throw new Error(`the layout names ${f.file}, which is not in ${folder}`)

  // Every line already in the canvas file, and in another copy of it, comments ordered by time.
  const lines = []
  for (const source of [out, options.commentsFrom].filter(Boolean)) {
    if (!fs.existsSync(source)) continue
    for (const line of storedLines(fs.readFileSync(source, 'utf8'))) if (!lines.includes(line)) lines.push(line)
  }
  const at = (l) => (/"at":"([^"]+)"/.exec(l)?.[1] ?? '')
  lines.sort((a, b) => at(a).localeCompare(at(b)))

  // A prototype changed since its last canvas edit, by something that is not the canvas, has
  // probably been rebuilt without the edit. Refused until somebody says it was meant.
  // A frame placed on the board by hand that the layout does not name (an artboard made on the
  // canvas) is drawn where it was placed.
  const placed = foldBoard(lines.flatMap((l) => parseLines(l, 'board'))).moved
  const named = new Set(frames.map((f) => f.file))
  const loose = Object.keys(placed)
    .filter((key) => /^[^#@/\\]+\.html$/.test(key) && !named.has(key) && fs.existsSync(path.join(folder, key)))
    .map((file) => ({ file, hash: '', label: labelOf(file, '') }))
  frames.push(...loose)

  const fileNames = [...new Set(frames.map((f) => f.file))]
  const drifted = []
  for (const file of fileNames) {
    const last = lastCarried(lines, file)
    if (!last) continue
    const now = sha(fs.readFileSync(path.join(folder, file), 'utf8'))
    if (now !== last.sha) drifted.push({ file, now })
  }
  if (drifted.length) {
    if (!options.accept) {
      throw new Error(
        `${drifted.map((d) => d.file).join(', ')} changed since the canvas last edited ${drifted.length === 1 ? 'it' : 'them'}, so a rebuild may have dropped those edits. ` +
          'Carry the edit lines into whatever writes the file, then build with --accept (or run accept on the file).',
      )
    }
    for (const d of drifted) lines.push(`<!-- edit ${JSON.stringify({ op: 'carried', id: randomId('e'), at: new Date().toISOString(), name: 'build', file: d.file, sha: d.now })} -->`)
  }

  if (!frames.length) {}
  else if (options.measure === false) for (const f of frames) Object.assign(f, { w: f.w ?? WIDTH, h: f.h ?? 1000 })
  else await measure(folder, frames, warnings)

  const assets = {}
  const files = {}
  const meta = {}
  for (const file of fileNames) {
    const text = fs.readFileSync(path.join(folder, file), 'utf8')
    files[file] = inlineFile(folder, file, text, assets, warnings)
    meta[file] = metaOf(text)
  }
  const payload = {
    key: options.key ?? path.basename(out, '.html') + ':' + path.basename(folder),
    title: layout.title,
    builtAt: new Date().toISOString(),
    pages: layout.pages,
    loose,
    files,
    meta,
    assets,
    crop: String(cropToOption),
    // Where comments go when nothing nearer takes them: a host's own endpoint, the same shape as serve's.
    comments: options.comments ?? layout.comments ?? null,
    // Opened from a website, it edits for every visitor, each in their own browser.
    play: !!layout.play,
    links: (layout.links ?? []).filter((l) => l && typeof l.text === 'string' && /^https?:\/\//i.test(l.href ?? '')).map((l) => ({ text: l.text, href: l.href })),
    serve: false,
  }
  writeFileAtomic(out, renderPage(payload, lines))
  if (!options.quiet) {
    const kb = Math.round(fs.statSync(out).size / 1024)
    console.log(`${path.relative(process.cwd(), out) || out}: ${layout.pages.length} page${layout.pages.length === 1 ? '' : 's'}, ${sections.length} section${sections.length === 1 ? '' : 's'}, ${frames.length} frames, ${lines.length} lines kept, ${kb} KB`)
    for (const w of [...new Set(warnings)]) console.log(`  note: ${w}`)
  }
  return { folder, out, payload, lines, warnings, options }
}

/** Serve a built canvas and take comments, board objects and edits. Returns the http server. */
export function serveCanvas(built, { port = 4410, strictPort = false, quiet = false, memory = false } = {}) {
  const { folder, out } = built
  let payload = built.payload
  let lines = [...built.lines]
  // Under --check the files stay as they are: edits go to copies held here.
  const mem = new Map()
  const readFile = (file) => (memory && mem.has(file) ? mem.get(file) : fs.readFileSync(path.join(folder, file), 'utf8'))
  // A prototype deleted while the canvas is served is drawn as a note saying so, not as an error.
  const readShown = (file) => {
    try {
      return readFile(file)
    } catch {
      return `<!doctype html>\n<html><body style="font: 32px system-ui; padding: 48px; color: #666">${esc(file)} is no longer in the folder.</body></html>\n`
    }
  }
  const writeFile = (file, text) => {
    if (memory) mem.set(file, text)
    else {
      ownWrites.set(file, text)
      writeFileAtomic(path.join(folder, file), text)
    }
  }
  const ownWrites = new Map()
  let canvasText = fs.readFileSync(out, 'utf8')
  // Held in memory, the page is rendered only when asked for (server.canvas.text, /api/canvas), never after each change.
  const writeOut = () => {
    if (memory) return
    canvasText = renderPage(payload, lines)
    writeFileAtomic(out, canvasText)
  }
  const servedFile = (file) => inlineFile(folder, file, tag(readShown(file)), payload.assets, [])
  const servedPage = () => renderPage({ ...payload, serve: true, memory, canvas: path.basename(out), files: Object.fromEntries(Object.keys(payload.files).map((f) => [f, servedFile(f)])) }, lines)
  // Rebuild from the prototypes and the layout, keeping every line, and tell every open page.
  const rebuild = async () => {
    const again = await buildCanvas({ ...built.options, quiet: true })
    payload = again.payload
    lines = again.lines
    canvasText = fs.readFileSync(out, 'utf8')
    tell('reload', {})
  }
  const refresh = (file) => {
    payload.files[file] = inlineFile(folder, file, readShown(file), payload.assets, [])
  }
  const undo = []
  const redo = []
  let selection = null
  const clients = new Set()
  const tell = (event, data) => {
    for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  // A prototype changed by something else (an agent, a build script): redraw it everywhere.
  if (!memory) {
    const timers = new Map()
    try {
      fs.watch(folder, (kind, name) => {
        if (!name || !payload.files[name]) return
        clearTimeout(timers.get(name))
        timers.set(name, setTimeout(() => {
          let text
          try {
            text = fs.readFileSync(path.join(folder, name), 'utf8')
          } catch {
            return
          }
          if (ownWrites.get(name) === text) return
          ownWrites.delete(name)
          refresh(name)
          writeOut()
          tell('file', { file: name })
        }, 150))
      })
    } catch {}
  }

  const describe = (src, cv) => {
    const el = cv == null ? null : parse(src).byStart.get(Number(cv))
    if (!el) return ''
    const cls = el.attrs.find((a) => a.name === 'class')?.value.trim().split(/\s+/).slice(0, 2).join('.')
    const name = el.attrs.find((a) => a.name === 'data-name')?.value
    return name ? `"${name}"` : `<${el.tag}${cls ? `.${cls}` : ''}>`
  }
  const summarize = (src, edit) => {
    const what = describe(src, [edit.cv].flat()[0])
    switch (edit.op) {
      case 'style':
        return `${what} ${Object.entries(edit.props).map(([k, v]) => `${k}: ${v === '' || v == null ? '(removed)' : v}`).join('; ')}`
      case 'rule':
        return `${edit.selector} ${Object.entries(edit.props).map(([k, v]) => `${k}: ${v === '' || v == null ? '(removed)' : v}`).join('; ')}`
      case 'inner':
        return `${what} now reads "${edit.html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 140)}"`
      case 'attr':
        return `${what} ${edit.name}=${JSON.stringify(edit.value ?? null)}`
      case 'move':
        return `${what} moved ${edit.where} ${describe(src, edit.target)}`
      case 'insert':
        return `new ${edit.html.slice(0, 80)} ${edit.where ?? 'inside'} ${what}`
      default:
        return `${edit.op} ${what}`
    }
  }
  const record = (event) => {
    lines.push(`<!-- edit ${JSON.stringify(event).replace(/--/g, '-\\u002d')} -->`)
  }

  // Only a file the canvas draws counts as on it: an own key, so `constructor` or `__proto__` is not.
  const onCanvas = (file) => typeof file === 'string' && Object.hasOwn(payload.files, file)
  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  // The body is gathered as bytes and decoded once, so a character split between two chunks stays whole.
  const MAX_BODY = 4_000_000
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (c) => {
        size += c.length
        if (size > MAX_BODY) {
          reject(Object.assign(new Error(`the request is larger than ${MAX_BODY / 1_000_000} MB`), { status: 413 }))
          req.removeAllListeners('data')
          req.resume()
          return
        }
        chunks.push(c)
      })
      req.on('error', reject)
      req.on('end', () => {
        if (size > MAX_BODY) return
        try {
          const body = Buffer.concat(chunks).toString('utf8')
          resolve(body ? JSON.parse(body) : {})
        } catch (err) {
          reject(err)
        }
      })
    })

  // Only this machine, and only the canvas's own page, reach the server. It listens on the loopback
  // address and answers no other host name, so a site that points its own name at 127.0.0.1 is
  // turned away. An /api/ call that another site's page sends is refused by its Origin and
  // Sec-Fetch-Site, so a page open in another tab cannot edit the prototypes.
  const hosts = () => [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`]
  const allowed = (req, url) => {
    if (!hosts().includes(req.headers.host)) return false
    if (!url.pathname.startsWith('/api/')) return true
    const origin = req.headers.origin
    if (origin && !hosts().some((h) => origin === `http://${h}`)) return false
    const site = req.headers['sec-fetch-site']
    return !site || site === 'same-origin' || site === 'none'
  }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    // No other site may frame the editor (and click through it), sniff a response into another type, or be told where it came from.
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('x-frame-options', 'SAMEORIGIN')
    res.setHeader('referrer-policy', 'no-referrer')
    res.setHeader('cross-origin-resource-policy', 'same-origin')
    if (!allowed(req, url)) return json(res, 403, { error: 'only the canvas served here may call it' })
    try {
      if (url.pathname === '/api/canvas-comments') {
        if (req.method === 'GET') return json(res, 200, { events: parseEvents(lines.join('\n')), viewer: null })
        const event = makeEvent((await readBody(req)).event)
        lines.push(insertEvent('', event).trim())
        writeOut()
        tell('lines', {})
        return json(res, 200, { event })
      }
      if (url.pathname === '/api/board') {
        if (req.method === 'GET') {
          const events = parseLines(lines.join('\n'), 'board')
          return json(res, 200, { events, board: foldBoard(events) })
        }
        const event = makeBoardEvent((await readBody(req)).event)
        lines.push(insertEvent('', event, 'board').trim())
        writeOut()
        tell('board', {})
        return json(res, 200, { event })
      }
      if (url.pathname === '/api/canvas') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${path.basename(out)}"` })
        return res.end(memory ? renderPage(payload, lines) : canvasText)
      }
      if (url.pathname === '/api/refresh' && req.method === 'POST') {
        if (memory) return json(res, 409, { error: 'a canvas held in memory cannot be rebuilt' })
        await rebuild()
        return json(res, 200, { ok: true })
      }
      if (url.pathname === '/api/artboard' && req.method === 'POST') {
        // A new blank prototype in the folder, placed on the board where it was drawn.
        const body = await readBody(req)
        const base = String(body.name ?? '').trim().toLowerCase().replace(/\.html$/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
        if (!base) return json(res, 400, { error: 'the artboard needs a name' })
        const file = `${base}.html`
        if (isCanvas(file)) return json(res, 400, { error: `${file} is the name of a canvas` })
        if (fs.existsSync(path.join(folder, file)) || mem.has(file)) return json(res, 409, { error: `${file} is already in the folder` })
        const w = Math.max(240, Math.min(3840, Math.round(Number(body.w) || WIDTH)))
        const title = String(body.name).trim().slice(0, 120)
        const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)}</title>\n<style>\n  body { margin: 0; font-family: system-ui, sans-serif; }\n</style>\n</head>\n<body>\n<main style="min-height: ${Math.max(240, Math.round(Number(body.h) || 900))}px; max-width: ${w}px">\n</main>\n</body>\n</html>\n`
        if (memory) return json(res, 409, { error: 'a canvas held in memory makes no files' })
        writeFileAtomic(path.join(folder, file), html)
        const event = makeBoardEvent({ op: 'move', key: file, x: Number(body.x) || 0, y: Number(body.y) || 0, page: body.page, name: body.by })
        lines.push(insertEvent('', event, 'board').trim())
        writeOut()
        await rebuild()
        return json(res, 200, { file })
      }
      if (url.pathname === '/api/file') {
        const file = url.searchParams.get('f')
        if (!onCanvas(file)) return json(res, 404, { error: `${file} is not on this canvas` })
        return json(res, 200, { html: servedFile(file) })
      }
      if (url.pathname === '/api/source') {
        const file = url.searchParams.get('f')
        if (!onCanvas(file)) return json(res, 404, { error: `${file} is not on this canvas` })
        const src = readFile(file)
        const el = parse(src).byStart.get(Number(url.searchParams.get('cv')))
        return json(res, 200, { html: el ? src.slice(el.start, el.end) : null })
      }
      if (url.pathname === '/api/edit' && req.method === 'POST') {
        const { file, edit, name } = await readBody(req)
        if (!onCanvas(file)) return json(res, 404, { error: `${file} is not on this canvas` })
        const before = readFile(file)
        const frameLocked = foldBoard(lines.flatMap((l) => parseLines(l, 'board'))).locked.some((k) => k === file || k.startsWith(`${file}#`))
        const refused = frameLocked ? 'This artboard is locked: unlock it on the board first' : lockedFor(before, edit, { owner: true })
        if (refused) return json(res, 403, { error: refused })
        const result = applyEdit(before, edit)
        if (result.src === before) return json(res, 200, { select: result.select, html: servedFile(file), same: true })
        writeFile(file, result.src)
        undo.push({ file, before, after: result.src })
        redo.length = 0
        record({ op: edit.op, id: randomId('e'), at: new Date().toISOString(), name: String(name || 'someone').slice(0, 80), file, summary: summarize(before, edit).slice(0, 600), sha: sha(result.src) })
        refresh(file)
        writeOut()
        return json(res, 200, { select: result.select, html: servedFile(file) })
      }
      if ((url.pathname === '/api/undo' || url.pathname === '/api/redo') && req.method === 'POST') {
        const { name } = await readBody(req)
        const from = url.pathname === '/api/undo' ? undo : redo
        const to = url.pathname === '/api/undo' ? redo : undo
        const step = from.pop()
        if (!step) return json(res, 200, { none: true })
        const now = readFile(step.file)
        const want = url.pathname === '/api/undo' ? step.before : step.after
        if (now !== (url.pathname === '/api/undo' ? step.after : step.before)) {
          return json(res, 409, { error: `${step.file} changed outside the canvas since; nothing was undone` })
        }
        writeFile(step.file, want)
        to.push(step)
        record({ op: url.pathname.slice(5), id: randomId('e'), at: new Date().toISOString(), name: String(name || 'someone').slice(0, 80), file: step.file, summary: url.pathname === '/api/undo' ? 'undid the last edit' : 'redid an edit', sha: sha(want) })
        refresh(step.file)
        writeOut()
        return json(res, 200, { file: step.file, html: servedFile(step.file) })
      }
      if (url.pathname === '/api/selection') {
        if (req.method === 'POST') {
          const asked = (await readBody(req)).selection ?? null
          // A drag box on the board: the region, and the objects and frames inside it.
          if (asked?.board) {
            const b = asked.board
            const refs = (list) => (Array.isArray(list) ? list.slice(0, 400).map(String) : [])
            selection = { board: { page: String(b.page ?? ''), box: { x: Number(b.box?.x) || 0, y: Number(b.box?.y) || 0, w: Number(b.box?.w) || 0, h: Number(b.box?.h) || 0 }, items: refs(b.items), frames: refs(b.frames) } }
            return json(res, 200, { ok: true })
          }
          if (asked && (!onCanvas(asked.file) || !Array.isArray(asked.cvs))) return json(res, 404, { error: `${asked.file} is not on this canvas` })
          selection = asked
          return json(res, 200, { ok: true })
        }
        if (selection?.board) {
          const all = foldBoard(parseLines(lines.join('\n'), 'board')).items
          const b = selection.board
          return json(res, 200, { selection: { board: { ...b, items: b.items.map((id) => all.find((i) => i.id === id)).filter(Boolean) } } })
        }
        if (!selection || !onCanvas(selection.file)) return json(res, 200, { selection: null })
        const src = readFile(selection.file)
        const els = selection.cvs.map((cv) => parse(src).byStart.get(Number(cv))).filter(Boolean)
        return json(res, 200, { selection: { ...selection, source: els.map((el) => ({ cv: el.start, html: src.slice(el.start, el.end) })) } })
      }
      if (url.pathname === '/api/agent') {
        const threads = foldEvents(parseEvents(lines.join('\n'))).filter((t) => t.agent && !t.resolved)
        return json(res, 200, { threads })
      }
      if (url.pathname === '/api/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
        res.write(': open\n\n')
        clients.add(res)
        req.on('close', () => clients.delete(res))
        return
      }
      // A prototype asked for by its own name is that prototype, not the canvas: a comparison board
      // frames its screens by file name, and answering those with the canvas nested the whole board
      // inside every board frame, again inside each of those, until the browser ran out of memory.
      const asked = decodeURIComponent(url.pathname.slice(1))
      // Only a page inside the folder: no climbing out, no drive or absolute path, no NUL.
      const within = (p) => path.resolve(folder, p).startsWith(path.resolve(folder) + path.sep)
      if (asked.endsWith('.html') && asked !== path.basename(out) && !asked.includes('..') && !asked.includes('\0') && within(asked)) {
        const html = onCanvas(asked) ? servedFile(asked) : fs.existsSync(path.join(folder, asked)) ? inlineFile(folder, asked, readFile(asked), payload.assets, []) : null
        if (html != null) {
          // Its stylesheets are written back in, the way a frame draws them.
          const page = html.replace(/<link\b[^>]*__RC_ASSET__\(([^)]+)\)[^>]*>/g, (_, a) => (payload.assets[a] ? `<style>${payload.assets[a].text}</style>` : ''))
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          return res.end(page)
        }
      }
      if (url.pathname === '/' || url.pathname.endsWith('.html')) {
        const page = servedPage()
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        return res.end(page)
      }
      json(res, 404, { error: 'not found' })
    } catch (err) {
      if (res.headersSent) res.end()
      else json(res, err.status ?? 400, { error: err.message })
    }
  })
  server.canvas = { get text() { return memory ? renderPage(payload, lines) : canvasText }, readFile, get lines() { return lines }, get payload() { return payload }, outside: (file, text) => (memory ? mem.set(file, text) : writeFileAtomic(path.join(folder, file), text)) }
  // A port another canvas (or anything else) already holds: unless this one was asked for by
  // name, the next free one up to 20 along; otherwise one plain line, not a stack.
  let at = port
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && !strictPort && port !== 0 && at < port + 20) {
      at++
      return server.listen(at, '127.0.0.1')
    }
    if (server.listenerCount('error') > 1) return
    console.error(err.code === 'EADDRINUSE' ? `Port ${at} is in use: close what holds it, or serve with --port <another>.` : `Could not serve: ${err.message}`)
    process.exitCode = 1
  })
  server.listen(port, '127.0.0.1', () => {
    if (!quiet) console.log(`Serving ${path.basename(out)} at http://127.0.0.1:${server.address().port}/${at !== port ? ` (${port} was in use)` : ''} : edits write into the prototypes in ${folder}, comments and edit lines into ${out}. Ctrl+C to stop.`)
  })
  return server
}

/** Record that each file changed on purpose since its last canvas edit. */
export function acceptFiles(folder, files, out = path.join(folder, 'canvas.html')) {
  let text = fs.readFileSync(out, 'utf8')
  for (const file of files) {
    const event = { op: 'carried', id: randomId('e'), at: new Date().toISOString(), name: 'accept', file, sha: sha(fs.readFileSync(path.join(folder, file), 'utf8')) }
    text = insertEvent(text, event, 'edit')
  }
  writeFileAtomic(out, text)
}

// ── the command line ──
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const valued = ['--layout', '--out', '--title', '--comments-from', '--comments', '--port', '--shots']
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
  const positional = args.filter((a, i) => !a.startsWith('--') && !valued.includes(args[i - 1]))
  const [command, folder, ...rest] = positional
  const usage = 'Usage: node canvas.mjs build|serve|check|accept <folder> [--layout canvas.json] [--out canvas.html] [--title t] [--comments-from file] [--no-measure] [--accept] [--port 4410] [--shots dir]'
  if (!['build', 'serve', 'check', 'accept'].includes(command) || !folder || !fs.existsSync(folder)) {
    console.error(usage)
    process.exit(2)
  }
  const options = { folder, layout: option('--layout'), out: option('--out'), title: option('--title'), commentsFrom: option('--comments-from'), comments: option('--comments'), measure: !args.includes('--no-measure'), accept: args.includes('--accept') }
  try {
    if (command === 'accept') {
      acceptFiles(path.resolve(folder), rest, options.out ? path.resolve(options.out) : undefined)
      console.log(`accepted ${rest.join(', ')}`)
    } else if (command === 'check') {
      const { check } = await import('./check.mjs')
      process.exit(await check({ ...options, shots: option('--shots') }, { buildCanvas, serveCanvas }))
    } else {
      const built = await buildCanvas(options)
      if (command === 'serve') serveCanvas(built, { port: Number(option('--port') ?? 4410), strictPort: option('--port') != null })
    }
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
