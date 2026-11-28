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
import { applyComponentEdit, applyEdit, componentEdit, cssDecl, lockedFor, parse, tag } from './lib/html.mjs'
import { inlineCss, inlineFile } from './lib/inline.mjs'
import { writeFileAtomic } from './lib/write.mjs'
import { cropToOption } from './lib/crop.mjs'
import { familyValue, fetchWebFont, WEB_FONTS } from './lib/webfont.mjs'
import { rebase } from './lib/rebase.mjs'
import { acceptSocket, makeRoom } from './lib/room.mjs'
import { hostRoom } from './lib/hostroom.mjs'
import { launchChromium } from './lib/browser.mjs'
import { CANVAS_MARK, boardRefused, commentRefused, foldBoard, foldEvents, insertEvent, makeBoardEvent, makeEvent, parseEvents, parseLines, randomId, storedLines } from './lib/events.mjs'

/** What the served canvas answers from a prototype's folder, by extension. */
const SERVED_TYPES = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.wasm': 'application/wasm' }

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
    return { title: name, comments: layout.comments ?? null, url: layout.url ?? null, room: typeof layout.room === 'string' && /^(wss:\/\/|ws:\/\/(127\.0\.0\.1|localhost)[:/])[^\s"'<>]+$/i.test(layout.room) ? layout.room : null, play: !!layout.play, links: Array.isArray(layout.links) ? layout.links : [], pages: pages.map((p, i) => ({ id: `p${i + 1}`, title: p.title ?? `Page ${i + 1}`, sections: p.sections ?? [] })) }
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

/** The width a prototype asks to be drawn at, `<meta name="canvas-width" content="390">`, or null for the board's 1440. */
function ownWidth(folder, file) {
  try {
    const n = Number(/<meta\s+name="canvas-width"\s+content="(\d+)"/i.exec(fs.readFileSync(path.join(folder, file), 'utf8'))?.[1])
    return n >= 240 && n <= 3840 ? n : null
  } catch {
    return null
  }
}

async function measure(folder, frames, warnings) {
  for (const f of frames) if (!f.crop) f.w = ownWidth(folder, f.file) ?? f.w
  let browser
  try {
    ;({ browser } = await launchChromium(folder))
  } catch (err) {
    warnings.push(`no browser to measure with, so every frame is drawn ${WIDTH} × 1000 (${err.message.split('\n')[0]})`)
    for (const f of frames) Object.assign(f, { w: f.w ?? WIDTH, h: 1000 })
    return
  }
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 1000 } })
  await page.route(/^https?:/, (route) => route.abort())
  for (const f of frames) {
    try {
      await page.setViewportSize({ width: f.crop ? WIDTH : f.w ?? WIDTH, height: 1000 })
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
      f.w ??= WIDTH
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
  `${stripped('events.mjs')}\nconst canvasHtml = (() => {\n${stripped('html.mjs')}\nreturn { parse, tag, untag, applyEdit, lockedFor, inCaseOf }\n})()\n`
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

/** The board's pictures, read from the folder, so a canvas.html sent alone still shows them (as a prototype's own
 *  pictures are carried inside it): each path the board's image objects name, as a data URL, up to 10 MB in all. */
const PICTURE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml' }
// Read and encoded once while the file is the same: the canvas is written again after every change.
const pictureCache = new Map()
function picturesOf(folder, lines) {
  const srcs = [...new Set(foldBoard(lines.flatMap((l) => parseLines(l, 'board'))).items.filter((i) => i.kind === 'image' && i.src).map((i) => i.src))]
  const out = {}
  let size = 0
  for (const src of srcs) {
    const full = path.resolve(folder, src)
    const type = PICTURE_TYPES[path.extname(src).toLowerCase()]
    if (!type || !full.startsWith(path.resolve(folder) + path.sep) || !fs.existsSync(full)) continue
    const st = fs.statSync(full)
    if (size + st.size > 10_000_000) break
    size += st.size
    const key = `${full}|${st.mtimeMs}|${st.size}`
    if (!pictureCache.has(key)) pictureCache.set(key, `data:${type};base64,${fs.readFileSync(full).toString('base64')}`)
    out[src] = pictureCache.get(key)
  }
  return out
}
function renderPage(payload, lines, folder = null) {
  if (folder) {
    const pictures = picturesOf(folder, lines)
    if (Object.keys(pictures).length) payload = { ...payload, pictures }
  }
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
  else if (options.measure === false) for (const f of frames) Object.assign(f, { w: (f.crop ? null : ownWidth(folder, f.file)) ?? f.w ?? WIDTH, h: f.h ?? 1000 })
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
    // A room on a host (a Cloudflare Worker, worker/room.js) that everyone opening this canvas joins, to see each other.
    room: layout.room ?? null,
    // Where the hosted copy lives, for the invite link the owner copies.
    url: typeof layout.url === 'string' && /^https:\/\/[^\s"'<>#]+$/i.test(layout.url) ? layout.url : null,
    // Opened from a website, it edits for every visitor, each in their own browser.
    play: !!layout.play,
    links: (layout.links ?? []).filter((l) => l && typeof l.text === 'string' && /^https?:\/\//i.test(l.href ?? '')).map((l) => ({ text: l.text, href: l.href })),
    serve: false,
  }
  writeFileAtomic(out, renderPage(payload, lines, folder))
  if (!options.quiet) {
    const kb = Math.round(fs.statSync(out).size / 1024)
    console.log(`${path.relative(process.cwd(), out) || out}: ${layout.pages.length} page${layout.pages.length === 1 ? '' : 's'}, ${sections.length} section${sections.length === 1 ? '' : 's'}, ${frames.length} frames, ${lines.length} lines kept, ${kb} KB`)
    for (const w of [...new Set(warnings)]) console.log(`  note: ${w}`)
  }
  return { folder, out, payload, lines, warnings, options }
}

/** Serve a built canvas and take comments, board objects and edits. Returns the http server. */
export function serveCanvas(built, { port = 4410, strictPort = false, quiet = false, memory = false, roomKey = process.env.DC_ROOM_KEY } = {}) {
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
    canvasText = renderPage(payload, lines, memory ? null : folder)
    writeFileAtomic(out, canvasText)
  }
  // A prototype at the top of the folder keeps its own picture paths, which the server answers; one in a subfolder
  // would resolve them from the canvas's address, so it has them written in. A stylesheet the page's own table of
  // sheets did not have when it was sent (one linked since, as a web font's) goes in as a <style> of its own, named
  // by its file as the page names the sheets it swaps in, since the page would drop a link to a sheet it has no copy of.
  let sentAssets = new Set(Object.keys(payload.assets))
  // The file as a page draws it, marked with the version of the file it was drawn from (data-dc-v on <html>): an
  // edit names its element by its place in that version, so one made from an older version is refused, not
  // written into the wrong element.
  const servedFile = (file) => {
    const src = readShown(file)
    return inlineFile(folder, file, tag(src), payload.assets, [], { keepMedia: !file.includes('/') })
      .replace(/<link\b[^>]*__RC_ASSET__\(([^)]+)\)[^>]*>/g, (all, a) => (sentAssets.has(a) || !payload.assets[a] ? all : `<style data-dc-sheet="${esc(a)}">${payload.assets[a].text.replace(/<\/style/gi, '<\\/style')}</style>`))
      .replace(/<html\b/i, (m) => `${m} data-dc-v="${sha(src)}"`)
  }
  // The pictures and clips the canvas's prototypes name from outside the folder, by the path the browser asks for
  // (a top-level prototype's paths are read from the canvas's own address), each to its file; worked out again at
  // most every two seconds, so one added to a prototype shows.
  let outsideCache = { at: 0, map: new Map() }
  const outsideMedia = () => {
    if (Date.now() - outsideCache.at < 2000) return outsideCache.map
    const map = new Map()
    const root = path.resolve(folder) + path.sep
    for (const file of Object.keys(payload.files)) {
      if (file.includes('/')) continue
      let src
      try { src = readShown(file) } catch { continue }
      for (const m of src.matchAll(/<(?:img|source|video|audio)\b[^>]*?\s(?:src|poster)="([^"]+)"/gi)) {
        const ref = m[1]
        if (/^(data:|https?:|\/\/|\/)/i.test(ref)) continue
        let clean
        try { clean = decodeURIComponent(ref.split(/[?#]/)[0]) } catch { continue }
        const full = path.resolve(folder, clean)
        if (full.startsWith(root) || !fs.existsSync(full) || !fs.statSync(full).isFile()) continue
        let asked
        try { asked = decodeURIComponent(new URL(ref, 'http://canvas/').pathname.slice(1)) } catch { continue }
        map.set(asked, full)
      }
    }
    outsideCache = { at: Date.now(), map }
    return map
  }
  const servedPage = () => renderPage({ ...payload, serve: true, memory, webFonts: memory ? [] : WEB_FONTS, canvas: path.basename(out), files: Object.fromEntries(Object.keys(payload.files).map((f) => [f, servedFile(f)])) }, lines)
  // Rebuild from the prototypes and the layout, keeping every line, and tell every open page.
  const rebuild = async () => {
    const again = await buildCanvas({ ...built.options, quiet: true })
    payload = again.payload
    sentAssets = new Set(Object.keys(payload.assets))
    lines = again.lines
    canvasText = fs.readFileSync(out, 'utf8')
    tell('reload', {})
  }
  const refresh = (file) => {
    payload.files[file] = inlineFile(folder, file, readShown(file), payload.assets, [])
  }
  // A stylesheet the prototypes link, changed: kept as the canvas writes it in, and every open page told, so each
  // frame that links it redraws.
  const sheetChanged = (sheet, text) => {
    payload.assets[sheet] = { type: 'text/css', text: inlineCss(text, path.join(folder, sheet), []) }
    tell('sheet', { sheet, text: payload.assets[sheet].text })
    return payload.assets[sheet].text
  }
  /** A linked sheet the canvas may write: one it has, inside the folder. */
  const sheetInFolder = (sheet) => typeof sheet === 'string' && !!payload.assets[sheet] && !sheet.split('/').some((s) => s === '..' || s.startsWith('.') || s === '') && path.resolve(folder, sheet).startsWith(path.resolve(folder) + path.sep)
  const undo = []
  const redo = []
  // Each step holds the whole file before and after, so the history keeps the last 200 (as the board's does): a long
  // day of edits to large screens does not grow the server without end.
  const UNDO_STEPS = 200
  // Each step is tagged with who made it (the page's x-dc-client header, or a room guest's id), so Ctrl+Z takes back
  // that person's own last change, as Figma's does, and not someone else's made since. A new change clears only that
  // person's redo.
  const whoOf = (req) => String(req.headers['x-dc-client'] ?? '').slice(0, 80)
  // A guest in the hosted room (their calls come through hostroom.mjs tagged room-<id>) isn't the owner: the owner is
  // whoever edits where the canvas lives, and only the owner locks, unlocks, or changes what is locked.
  const isGuest = (req) => whoOf(req).startsWith('room-')
  const pushUndo = (step, who) => {
    undo.push({ ...step, by: who })
    if (undo.length > UNDO_STEPS) undo.splice(0, undo.length - UNDO_STEPS)
    for (let i = redo.length - 1; i >= 0; i--) if (redo[i].by === who) redo.splice(i, 1)
  }
  let selection = null
  const clients = new Set()
  // The hosted room this canvas is the host of (canvas.json's room, with DC_ROOM_KEY): told the same news.
  let hosted = null
  const tell = (event, data) => {
    for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    hosted?.tell(event, data)
  }

  // A prototype changed by something else (an agent, a build script): redraw it everywhere.
  if (!memory) {
    const timers = new Map()
    try {
      fs.watch(folder, (kind, name) => {
        if (name && payload.assets[name] && sheetInFolder(name)) {
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
            sheetChanged(name, text)
            writeOut()
          }, 150))
          return
        }
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
    const what = edit.cv == null ? '' : describe(src, [edit.cv].flat()[0])
    switch (edit.op) {
      case 'styles':
        return `${(edit.items ?? []).length} elements: ${(edit.items ?? []).map((it) => `${describe(src, it.cv)} ${Object.entries(it.props).map(([k, v]) => `${k}: ${v === '' || v == null ? '(removed)' : v}`).join('; ')}`).join(' · ')}`
      case 'style':
        return `${what} ${Object.entries(edit.props).map(([k, v]) => `${k}: ${v === '' || v == null ? '(removed)' : v}`).join('; ')}`
      case 'link':
        return `linked ${edit.href}`
      case 'decl':
        return `${edit.selector} ${edit.prop}: ${edit.value === '' || edit.value == null ? '(removed)' : edit.value}`
      case 'rule':
        return `${edit.selector} ${Object.entries(edit.props).map(([k, v]) => `${k}: ${v === '' || v == null ? '(removed)' : v}`).join('; ')}`
      case 'inner':
        return `${what} now reads "${edit.html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 140)}"`
      case 'attr':
        return `${what} ${edit.name}=${JSON.stringify(edit.value ?? null)}`
      case 'move':
        return `${what} ${edit.copy ? 'copied' : 'moved'} ${edit.where} ${describe(src, edit.target)}`
      case 'insert':
        return `new ${edit.html.slice(0, 80)} ${edit.where ?? 'inside'} ${what}`
      case 'replaceText':
        return `replaced ${JSON.stringify(String(edit.find).slice(0, 80))} with ${JSON.stringify(String(edit.with ?? '').slice(0, 80))} in the text`
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

  /** A request's bytes as they came, up to `max`. */
  const readBytes = (req, max) =>
    new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (c) => {
        size += c.length
        if (size > max) {
          reject(Object.assign(new Error(`the picture is larger than ${max / 1_000_000} MB`), { status: 413 }))
          req.removeAllListeners('data')
          req.resume()
          return
        }
        chunks.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(chunks)))
      req.on('error', reject)
    })
  // A picture's kind by its first bytes, so a file named .png is one.
  const PICTURES = {
    png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    gif: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8',
    webp: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
    avif: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' && /avi[fs]/.test(b.subarray(8, 12).toString('latin1')),
  }

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
  // The browser pictures are made in: started on the first one asked for, kept for the next, closed with the server.
  let shooter = null
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
        const said = parseEvents(lines.join('\n'))
        // People delete what they wrote; the owner deletes anything.
        if (isGuest(req) && event.op === 'delete') {
          const m = foldEvents(said).flatMap((x) => [x, ...x.replies]).find((x) => x.id === event.to)
          if (m && m.name !== event.name) return json(res, 403, { error: 'Only the one who wrote it, or the owner, can delete it.' })
        }
        const refused = commentRefused(said, event)
        if (refused) return json(res, 409, { error: refused })
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
        if (isGuest(req)) {
          if (event.op === 'lock') return json(res, 403, { error: 'Only the owner can lock and unlock things.' })
          const held = foldBoard(parseLines(lines.join('\n'), 'board')).locked
          if (['item', 'remove', 'move'].includes(event.op) && held.includes(event.op === 'move' ? event.key : event.id)) return json(res, 403, { error: 'That is locked' })
        }
        const refused = boardRefused(parseLines(lines.join('\n'), 'board'), event)
        if (refused) return json(res, 409, { error: refused })
        lines.push(insertEvent('', event, 'board').trim())
        writeOut()
        tell('board', {})
        return json(res, 200, { event })
      }
      if (url.pathname === '/api/invite') {
        // The hosted copy's address with the invite key, for the owner's own page (never relayed to a guest).
        if (!server.hosted || !payload.url) return json(res, 404, { error: 'This canvas is not the host of a room with a hosted address.' })
        return json(res, 200, { link: `${payload.url}#invite=${server.hosted.editKey}` })
      }
      if (url.pathname === '/api/history') {
        // Every edit recorded in the canvas, oldest first: who, when, which file, what.
        return json(res, 200, { edits: lines.flatMap((l) => parseLines(l, 'edit')) })
      }
      if (url.pathname === '/api/canvas') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${path.basename(out)}"` })
        return res.end(memory ? renderPage(payload, lines, folder) : canvasText)
      }
      if (url.pathname === '/api/refresh' && req.method === 'POST') {
        if (memory) return json(res, 409, { error: 'This canvas is held in memory, so it can\'t be rebuilt.' })
        await rebuild()
        return json(res, 200, { ok: true })
      }
      if (url.pathname === '/api/artboard' && req.method === 'POST') {
        // A new blank prototype in the folder, placed on the board where it was drawn.
        const body = await readBody(req)
        // Or copies of prototypes on the board (Ctrl+D on screens): each file copied whole to <name>-copy.html, the
        // next free name, and placed where asked.
        if (Array.isArray(body.copies)) {
          if (memory) return json(res, 409, { error: 'This canvas is held in memory, so it can\'t make new files.' })
          const made = []
          for (const c of body.copies.slice(0, 20)) {
            const from = String(c?.from ?? '')
            if (!onCanvas(from)) return json(res, 404, { error: `${from} is not on this canvas` })
            const base = from.replace(/\.html$/, '').replace(/^.*\//, '').replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 54)
            const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : ''
            let file = `${dir}${base}-copy.html`
            for (let n = 2; fs.existsSync(path.join(folder, file)) || payload.files[file]; n++) file = `${dir}${base}-copy-${n}.html`
            writeFileAtomic(path.join(folder, file), readFile(from))
            lines.push(insertEvent('', makeBoardEvent({ op: 'move', key: file, x: Number(c.x) || 0, y: Number(c.y) || 0, page: body.page, name: body.by }), 'board').trim())
            made.push(file)
          }
          writeOut()
          await rebuild()
          return json(res, 200, { files: made })
        }
        const base = String(body.name ?? '').trim().toLowerCase().replace(/\.html$/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
        if (!base) return json(res, 400, { error: 'the artboard needs a name' })
        const file = `${base}.html`
        if (isCanvas(file)) return json(res, 400, { error: `${file} is the name of a canvas` })
        if (fs.existsSync(path.join(folder, file)) || mem.has(file)) return json(res, 409, { error: `${file} is already in the folder` })
        const w = Math.max(240, Math.min(3840, Math.round(Number(body.w) || WIDTH)))
        const title = String(body.name).trim().slice(0, 120)
        const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)}</title>\n${w === WIDTH ? '' : `<meta name="canvas-width" content="${w}">\n`}<style>\n  body { margin: 0; font-family: system-ui, sans-serif; }\n</style>\n</head>\n<body>\n<main style="min-height: ${Math.max(240, Math.round(Number(body.h) || 900))}px">\n</main>\n</body>\n</html>\n`
        if (memory) return json(res, 409, { error: 'This canvas is held in memory, so it can\'t make new files.' })
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
      // A web font picked for a prototype: its files downloaded once into the folder's fonts/, answered with the sheet's
      // path from the prototype, which the page then links by a `link` edit, so the font shows on the board, in the
      // built canvas and offline.
      // A picture dropped or pasted onto the canvas, saved into the folder's images/ for the board or a prototype to
      // show by its path there. The same picture dropped again is the file already there; another of the same name
      // takes a number. Only PNG, JPEG, GIF, WebP and AVIF, by their bytes: an SVG can carry script.
      if (url.pathname === '/api/image' && req.method === 'POST') {
        if (memory) return json(res, 409, { error: 'This canvas is held in memory, so it can\'t make new files.' })
        const bytes = await readBytes(req, 15_000_000)
        const ext = Object.keys(PICTURES).find((k) => PICTURES[k](bytes))
        if (!ext) return json(res, 415, { error: 'a PNG, JPEG, GIF, WebP or AVIF picture' })
        const base = (url.searchParams.get('name') || 'image').replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image'
        fs.mkdirSync(path.join(folder, 'images'), { recursive: true })
        for (let n = 1; ; n++) {
          const src = `images/${base}${n > 1 ? `-${n}` : ''}.${ext}`
          const full = path.join(folder, src)
          if (!fs.existsSync(full)) {
            writeFileAtomic(full, bytes)
            return json(res, 200, { src, saved: true })
          }
          if (fs.readFileSync(full).equals(bytes)) return json(res, 200, { src, saved: false })
        }
      }
      // A picture of a screen, or of one element in it, as Figma's Copy as PNG and Export: the prototype as served,
      // opened at its frame's width in the browser the canvas measures with, at twice its size.
      if (url.pathname === '/api/png' && req.method === 'GET') {
        const file = url.searchParams.get('f') ?? ''
        if (!onCanvas(file)) return json(res, 404, { error: `${file} is not on this canvas` })
        const w = Math.min(3840, Math.max(240, Math.round(Number(url.searchParams.get('w')) || WIDTH)))
        const cv = url.searchParams.get('cv')
        const hash = (url.searchParams.get('hash') ?? '').replace(/[^\w-]/g, '')
        let page
        try {
          shooter ??= launchChromium(folder).then((r) => r.browser)
          // As tall as its frame is drawn, so the whole screen comes out the size it is on the board.
          const tall = Math.min(20000, Math.max(200, Math.round(Number(url.searchParams.get('h')) || 900)))
          // Figma's export scale (0.5× to 4×, twice by default) and format: PNG, or JPG with no see-through parts.
          const scale = Math.min(4, Math.max(0.5, Number(url.searchParams.get('scale')) || 2))
          const type = url.searchParams.get('type') === 'jpeg' ? 'jpeg' : 'png'
          page = await (await shooter).newPage({ viewport: { width: w, height: tall }, deviceScaleFactor: scale })
          await page.goto(`http://127.0.0.1:${server.address().port}/${file.split('/').map(encodeURIComponent).join('/')}${hash ? `#${hash}` : ''}`, { waitUntil: 'load', timeout: 20000 })
          const scheme = url.searchParams.get('scheme')
          if (scheme === 'dark' || scheme === 'light') await page.emulateMedia({ colorScheme: scheme })
          await page.evaluate(() => document.fonts?.ready)
          const el = cv != null && cv !== '' ? await page.$(`[data-cv="${Number(cv)}"]`) : null
          if (cv != null && cv !== '' && !el) return json(res, 404, { error: 'That element isn\'t in the file any more.' })
          const how = { type, ...(type === 'jpeg' ? { quality: 90 } : {}) }
          // Several elements (Copy as PNG with more than one selected): one picture of the box round them all.
          const many = (url.searchParams.get('cvs') ?? '').split(',').filter((x) => /^\d+$/.test(x)).slice(0, 200).map(Number)
          const clip = many.length > 1 ? await page.evaluate((cvs) => {
            const rs = cvs.map((n) => document.querySelector(`[data-cv="${n}"]`)?.getBoundingClientRect()).filter((r) => r && (r.width || r.height))
            if (!rs.length) return null
            const x = Math.min(...rs.map((r) => r.left)) + scrollX
            const y = Math.min(...rs.map((r) => r.top)) + scrollY
            return { x, y, width: Math.max(...rs.map((r) => r.right)) + scrollX - x, height: Math.max(...rs.map((r) => r.bottom)) + scrollY - y }
          }, many) : null
          if (many.length > 1 && !clip) return json(res, 404, { error: "Those elements aren't in the file any more." })
          const png = clip ? await page.screenshot({ ...how, fullPage: true, clip }) : el ? await el.screenshot(how) : await page.screenshot({ ...how, fullPage: true })
          res.writeHead(200, { 'content-type': `image/${type}`, 'cache-control': 'no-store' })
          return res.end(png)
        } catch (e) {
          return json(res, 422, { error: `no picture was made (${String(e.message).split('\n')[0]})` })
        } finally {
          await page?.close().catch(() => {})
        }
      }
      // A picture of part of the board, as FigJam's Copy as PNG and Export: this canvas opened in the same browser,
      // that part of the page shown at 100% from its top left with nothing of the canvas's own over it, at twice the
      // size. Up to 4000 board px a side.
      if (url.pathname === '/api/board-png' && req.method === 'GET') {
        const n = (k) => Number(url.searchParams.get(k))
        const box = { x: n('x'), y: n('y'), w: Math.min(4000, Math.max(16, n('w'))), h: Math.min(4000, Math.max(16, n('h'))) }
        if (![box.x, box.y, box.w, box.h].every(Number.isFinite)) return json(res, 400, { error: 'x, y, w and h are needed' })
        const pageId = String(url.searchParams.get('page') ?? '').replace(/[^\w-]/g, '')
        let page
        try {
          shooter ??= launchChromium(folder).then((r) => r.browser)
          page = await (await shooter).newPage({ viewport: { width: Math.ceil(box.w), height: Math.ceil(box.h) }, deviceScaleFactor: 2 })
          await page.goto(`http://127.0.0.1:${server.address().port}/?dc-shot${pageId ? `#page=${pageId}` : ''}`, { waitUntil: 'load', timeout: 20000 })
          await page.waitForFunction(() => window.designCanvas?.shootBoard && (window.designCanvas.allFrames ?? []).every((f) => !f.el || f.doc), null, { timeout: 20000 })
          let modes = {}
          try { modes = JSON.parse(url.searchParams.get('modes') || '{}') } catch {}
          await page.evaluate(([b, m, as]) => window.designCanvas.shootBoard(b, m, as), [box, modes && typeof modes === 'object' ? modes : {}, String(url.searchParams.get('as') ?? '')])
          await page.evaluate(() => document.fonts?.ready)
          await page.waitForTimeout(400)
          const png = await page.screenshot({ type: 'png' })
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
          return res.end(png)
        } catch (e) {
          return json(res, 422, { error: `no picture was made (${String(e.message).split('\n')[0]})` })
        } finally {
          await page?.close().catch(() => {})
        }
      }
      // A screen as a PDF, as Figma's Export: the prototype as served, at its frame's width, printed by the same
      // browser as one page as tall as the screen, its look as on screen (not its print styles), its words as type.
      if (url.pathname === '/api/pdf' && req.method === 'GET') {
        const file = url.searchParams.get('f') ?? ''
        if (!onCanvas(file)) return json(res, 404, { error: `${file} is not on this canvas` })
        const w = Math.min(3840, Math.max(240, Math.round(Number(url.searchParams.get('w')) || WIDTH)))
        const hash = (url.searchParams.get('hash') ?? '').replace(/[^\w-]/g, '')
        let page
        try {
          shooter ??= launchChromium(folder).then((r) => r.browser)
          // As tall as its frame is drawn, as a picture of it is, or taller where the page runs on.
          const drawn = Math.min(20000, Math.max(200, Math.round(Number(url.searchParams.get('h')) || 900)))
          page = await (await shooter).newPage({ viewport: { width: w, height: drawn } })
          await page.goto(`http://127.0.0.1:${server.address().port}/${file.split('/').map(encodeURIComponent).join('/')}${hash ? `#${hash}` : ''}`, { waitUntil: 'load', timeout: 20000 })
          const scheme = url.searchParams.get('scheme')
          await page.emulateMedia({ media: 'screen', ...(scheme === 'dark' || scheme === 'light' ? { colorScheme: scheme } : {}) })
          await page.evaluate(() => document.fonts?.ready)
          const tall = await page.evaluate(() => Math.ceil(Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0)))
          const pdf = await page.pdf({ width: `${w}px`, height: `${Math.min(20000, Math.max(drawn, tall))}px`, printBackground: true, pageRanges: '1', margin: { top: 0, right: 0, bottom: 0, left: 0 } })
          res.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'no-store' })
          return res.end(pdf)
        } catch (e) {
          return json(res, 422, { error: `no PDF was made (${String(e.message).split('\n')[0]})` })
        } finally {
          await page?.close().catch(() => {})
        }
      }
      if (url.pathname === '/api/font' && req.method === 'POST') {
        const { file, family } = await readBody(req)
        if (!onCanvas(file)) return json(res, 404, { error: `${file} is not on this canvas` })
        if (memory) return json(res, 409, { error: 'This canvas is held in memory, so it can\'t make new files.' })
        try {
          const { sheet, fetched } = await fetchWebFont(folder, String(family))
          return json(res, 200, { href: path.posix.relative(path.posix.dirname(file), sheet), value: familyValue(String(family)), fetched })
        } catch (e) {
          return json(res, 502, { error: e.message })
        }
      }
      // One declaration of a rule in a stylesheet the prototypes link (a shared portal.css), changed in that file, so
      // every prototype linking it follows. A sheet outside the folder is read only.
      if (url.pathname === '/api/sheet' && req.method === 'POST') {
        const { sheet, selector, nth, prop, value, name } = await readBody(req)
        if (!sheetInFolder(sheet)) return json(res, 404, { error: `${sheet} is not a stylesheet in this folder` })
        const before = readFile(sheet)
        let after
        try {
          after = cssDecl(before, String(selector), nth, prop, value)
        } catch (e) {
          return json(res, 400, { error: e.message })
        }
        if (after === before) return json(res, 200, { sheet, text: payload.assets[sheet].text, same: true })
        writeFile(sheet, after)
        pushUndo({ file: sheet, before, after, sheet: true }, whoOf(req))
        record({ op: 'decl', id: randomId('e'), at: new Date().toISOString(), name: String(name || 'someone').slice(0, 80), file: sheet, summary: `${selector} ${prop}: ${value === '' || value == null ? '(removed)' : value}`.slice(0, 600), sha: sha(after) })
        const text = sheetChanged(sheet, after)
        writeOut()
        return json(res, 200, { sheet, text })
      }
      if (url.pathname === '/api/edit' && req.method === 'POST') {
        const { file, edit, name, files, v } = await readBody(req)
        // Replace all: the words replaced on every screen asked for, in one undo step; a locked screen is left as it is.
        if (edit?.op === 'replaceText' && Array.isArray(files)) {
          const lockedFiles = foldBoard(lines.flatMap((l) => parseLines(l, 'board'))).locked
          const parts = []
          let count = 0
          for (const f of [...new Set(files)]) {
            if (!onCanvas(f) || lockedFiles.some((k) => k === f || k.startsWith(`${f}#`))) continue
            const was = readFile(f)
            if (lockedFor(was, edit, { owner: !isGuest(req) })) continue
            const r = applyEdit(was, edit)
            if (r.src === was) continue
            writeFile(f, r.src)
            parts.push({ file: f, before: was, after: r.src })
            count += r.count ?? 0
          }
          if (!parts.length) return json(res, 200, { same: true, count: 0, files: {} })
          pushUndo({ ...parts[0], also: parts.slice(1) }, whoOf(req))
          const elsewhere = parts.length > 1 ? ` (and on ${parts.length - 1} other screen${parts.length === 2 ? '' : 's'})` : ''
          record({ op: edit.op, id: randomId('e'), at: new Date().toISOString(), name: String(name || 'someone').slice(0, 80), file: parts[0].file, summary: `${summarize(parts[0].before, edit)}${elsewhere}`.slice(0, 600), sha: sha(parts[0].after) })
          for (const p of parts) { refresh(p.file); tell('file', { file: p.file, by: whoOf(req) }) }
          writeOut()
          return json(res, 200, { count, files: Object.fromEntries(parts.map((p) => [p.file, servedFile(p.file)])) })
        }
        if (!onCanvas(file)) return json(res, 404, { error: `${file} is not on this canvas` })
        const before = readFile(file)
        if (v && v !== sha(before)) return json(res, 409, { error: `${file} changed somewhere else just before this. It's shown as it is now, so please do that again.` })
        const frameLocked = foldBoard(lines.flatMap((l) => parseLines(l, 'board'))).locked.some((k) => k === file || k.startsWith(`${file}#`))
        const refused = frameLocked ? 'This artboard is locked: unlock it on the board first' : lockedFor(before, edit, { owner: !isGuest(req) })
        if (refused) return json(res, 403, { error: refused })
        const link = componentEdit(before, edit)
        const result = applyEdit(before, edit)
        if (result.src === before) return json(res, 200, { select: result.select, html: servedFile(file), same: true })
        writeFile(file, result.src)
        // A component's copies on the other screens take the same change (a header used on many screens), in the
        // same undo step; a locked screen is left as it is.
        const also = []
        if (link) {
          const lockedFiles = foldBoard(lines.flatMap((l) => parseLines(l, 'board'))).locked
          for (const other of Object.keys(payload.files)) {
            if (other === file || lockedFiles.some((k) => k === other || k.startsWith(`${other}#`))) continue
            const was = readFile(other)
            if (!was.includes('data-component=')) continue
            const r = applyComponentEdit(was, link, edit)
            if (!r.count || r.src === was) continue
            writeFile(other, r.src)
            also.push({ file: other, before: was, after: r.src, count: r.count })
          }
        }
        pushUndo({ file, before, after: result.src, also: also.map(({ file, before, after }) => ({ file, before, after })) }, whoOf(req))
        const elsewhere = also.length ? ` (and on ${also.length} other screen${also.length === 1 ? '' : 's'})` : ''
        record({ op: edit.op, id: randomId('e'), at: new Date().toISOString(), name: String(name || 'someone').slice(0, 80), file, summary: `${summarize(before, edit)}${elsewhere}`.slice(0, 600), sha: sha(result.src) })
        refresh(file)
        for (const a of also) refresh(a.file)
        // Every other page with the canvas open redraws what changed; the page that made the change skips its own.
        for (const f of [file, ...also.map((a) => a.file)]) tell('file', { file: f, by: whoOf(req) })
        writeOut()
        return json(res, 200, { select: result.select, linked: (result.linked ?? 0) + also.reduce((n, a) => n + a.count, 0), screens: also.length, count: result.count, html: servedFile(file), others: Object.fromEntries(also.map((a) => [a.file, servedFile(a.file)])) })
      }
      if ((url.pathname === '/api/undo' || url.pathname === '/api/redo') && req.method === 'POST') {
        const { name } = await readBody(req)
        const from = url.pathname === '/api/undo' ? undo : redo
        const to = url.pathname === '/api/undo' ? redo : undo
        // This person's own last step, wherever it is in the history.
        const who = whoOf(req)
        let at = -1
        for (let i = from.length - 1; i >= 0 && at < 0; i--) if (from[i].by === who) at = i
        if (at < 0) return json(res, 200, { none: true })
        const [step] = from.splice(at, 1)
        const back = url.pathname === '/api/undo'
        // Every file the step changed (a component's copies on other screens too) is worked out before any is
        // written. A file changed outside since (an agent wrote another part of it) has the step's own change undone
        // in it and the rest kept; when the part the step changed was itself changed, nothing is undone, and the step
        // stays to be tried again.
        const parts = [{ file: step.file, before: step.before, after: step.after }, ...(step.also ?? [])]
        const next = parts.map((p) => rebase(readFile(p.file), back ? p.after : p.before, back ? p.before : p.after))
        const stuck = parts.find((p, i) => next[i] == null)
        if (stuck) {
          from.splice(at, 0, step)
          return json(res, 409, { error: `${stuck.file} changed outside the canvas where this was made; nothing was ${back ? 'undone' : 'redone'}` })
        }
        const was = readFile(step.file)
        parts.forEach((p, i) => writeFile(p.file, next[i]))
        to.push(step)
        const want = next[0]
        // The innermost element round what changed, by its offset in the file as it is now, so the canvas can select
        // what came back, as Figma's undo does. Nothing for a change in the head, a style or a script.
        const changedAt = (() => {
          let s = 0
          while (s < was.length && s < want.length && was[s] === want[s]) s++
          let ea = was.length
          let eb = want.length
          while (ea > s && eb > s && was[ea - 1] === want[eb - 1]) { ea--; eb-- }
          let best = null
          for (const el of parse(want).byStart.values()) if (el.start <= s && el.end >= eb && (!best || el.start > best.start)) best = el
          return best && !['html', 'head', 'body', 'style', 'script', 'meta', 'link', 'title'].includes(best.tag) ? best.start : null
        })()
        record({ op: url.pathname.slice(5), id: randomId('e'), at: new Date().toISOString(), name: String(name || 'someone').slice(0, 80), file: step.file, summary: url.pathname === '/api/undo' ? 'undid the last edit' : 'redid an edit', sha: sha(want) })
        if (step.sheet) {
          const text = sheetChanged(step.file, want)
          writeOut()
          return json(res, 200, { sheet: step.file, text })
        }
        for (const p of parts) { refresh(p.file); tell('file', { file: p.file, by: who }) }
        writeOut()
        return json(res, 200, { file: step.file, cv: changedAt, html: servedFile(step.file), others: Object.fromEntries((step.also ?? []).map((p) => [p.file, servedFile(p.file)])) })
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
      // A prototype's own files that it asks for as it runs (a picture at another size from srcset, a module it imports,
      // a depth map, a font): read from its folder, to this machine only, so they show on the board as in a browser.
      // Hidden files and folders (.git, .env) are never served.
      const type = SERVED_TYPES[path.extname(asked).toLowerCase()]
      if (req.method === 'GET' && type && !asked.includes('\0') && !asked.split(/[\\/]/).some((s) => s.startsWith('.') || s === '') && within(asked)) {
        const full = path.join(folder, asked)
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' })
          return res.end(fs.readFileSync(full))
        }
      }
      // A picture or clip a prototype names from outside the folder (a design's ../imgs/): the page keeps its path, the
      // browser asks for it where that path leads from the canvas, and that file alone is answered, nothing else
      // outside the folder.
      const named = req.method === 'GET' && type && /^(image|video|audio)\//.test(type) ? outsideMedia().get(asked) : null
      if (named) {
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' })
        return res.end(fs.readFileSync(named))
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
  server.on('close', () => { shooter?.then((b) => b.close()).catch(() => {}) })
  server.canvas = { get text() { return memory ? renderPage(payload, lines, folder) : canvasText }, readFile, get lines() { return lines }, get payload() { return payload }, outside: (file, text) => {
    // As a write from outside: on disk the watcher tells the pages; in memory they are told here, as the watcher would.
    if (!memory) return writeFileAtomic(path.join(folder, file), text)
    mem.set(file, text)
    refresh(file)
    tell('file', { file })
  } }
  // Who else has this canvas open, and where their pointer is: the room at /api/room, over a WebSocket, held to the
  // same same-site rule as every other call.
  const room = makeRoom()
  server.room = room
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://local')
    if (url.pathname !== '/api/room' || !allowed(req, url)) return socket.destroy()
    acceptSocket(req, socket, room).catch(() => socket.destroy())
  })
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
  server.on('listening', () => {
    // The owner key: DC_ROOM_KEY, or a .room-key file beside the prototypes (kept out of git by .gitignore).
    let key = roomKey
    if (!key) try { key = fs.readFileSync(path.join(folder, '.room-key'), 'utf8').trim() } catch {}
    if (!payload.room || !key || hosted) return
    hosted = hostRoom({ room: payload.room, ownerKey: key, base: `http://127.0.0.1:${server.address().port}`, log: (m) => { if (!quiet) console.log(m) } })
    server.hosted = hosted
  })
  server.on('close', () => hosted?.close())
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
