// What people do on a canvas, kept in the canvas file itself, one line each.
//
// Every line is an HTML comment holding one JSON event, written before `</body>`:
//
//   <!-- comment {"op":"add","id":"c-…","at":"…","name":"Ada","text":"…","frame":"v1.html#s-quiz","x":120,"y":340} -->
//   <!-- edit {"op":"style","id":"e-…","at":"…","name":"Ada","file":"v1.html","summary":"…","sha":"…"} -->
//   <!-- board {"op":"note","id":"b-…","at":"…","name":"Ada","x":0,"y":0,"w":400,"h":300,"text":"…"} -->
//
// The file is the record: it opens anywhere with everything it was published with, a rebuild
// carries the lines over, and git shows who did what. Nothing is ever rewritten; the state is
// the lines folded in order.
//
// A comment line is `add`, `reply`, `resolve`, `delete` or `agent`, and a host that takes comment
// lines for a published copy reads and writes them as they are. `add` may carry `file` and
// `anchor`, which pin it to an element; a host that does not know them ignores them, and the pin
// falls back to its `x` and `y`.
//
// A board line is `item` (a note, title, shape, section, line, arrow, pencil stroke or layout
// guide, last line for an id wins), `remove`, `move` (a frame placed by hand, on a page), `page` (a
// page made, renamed or removed), `name` (the canvas's own title) and `lock` (a frame's key or a board
// object's id, `locked` true or false: a locked one is not moved, changed or removed, and nothing new
// is put over it, until its owner unlocks it). A line or arrow may carry
// `from` and `to`, each a board object's id or a frame's key, and is then drawn between those two
// wherever they are; its own `points` are where it is drawn once either end is gone.
//
// A comment `add` may carry `box` ({ x, y, w, h } on the board) and `items` (board object ids and
// frame keys): the region of the board it is about, as a drag-box selection left it.
//
// This file is inlined into the page and used by the server, so it has no imports.

export const CANVAS_MARK = 'review-canvas'
export const EVENT_PREFIX = 'comment '
export const LIMITS = { name: 80, text: 4000, frame: 240, events: 5000 }
const OPS = ['add', 'reply', 'resolve', 'delete', 'agent']
const KINDS = ['comment', 'edit', 'board']

/** One event as the line that stores it. `--` only ever occurs inside a JSON string, so writing
 * the second dash as `-` keeps the JSON identical and the HTML comment unbroken. */
export function eventLine(event, kind = 'comment') {
  return `<\!-- ${kind} ${JSON.stringify(event).replace(/--/g, '-\\u002d')} -->`
}

/** Every comment event stored in an HTML document, in file order. A line that is not a valid
 * event is skipped, never fatal: one bad hand edit must not hide every other comment. */
export function parseEvents(html) {
  return parseLines(html, 'comment').filter((e) => OPS.includes(e.op))
}

/** Every event of one kind, in file order. */
export function parseLines(html, kind) {
  const events = []
  const re = new RegExp(`<\\!-- ${kind} (\\{.*?\\}) -->`, 'g')
  for (const m of html.matchAll(re)) {
    try {
      const event = JSON.parse(m[1])
      if (event && typeof event.op === 'string') events.push(event)
    } catch {}
  }
  return events
}

/** Every stored line of any kind, as written, in file order. */
export function storedLines(html) {
  const re = new RegExp(`^<\\!-- (?:${KINDS.join('|')}) \\{.*\\} -->$`)
  return html.split('\n').map((l) => l.trim()).filter((l) => re.test(l))
}

/** The document with one more event line, written before the last `</body>`. */
export function insertEvent(html, event, kind = 'comment') {
  const line = `${eventLine(event, kind)}\n`
  const at = html.lastIndexOf('</body>')
  return at < 0 ? `${html}\n${line}` : `${html.slice(0, at)}${line}${html.slice(at)}`
}

const text = (value, max, field) => {
  if (typeof value !== 'string') throw new Error(`${field} is required`)
  const clean = value.replace(/\r\n?/g, '\n').trim()
  if (!clean) throw new Error(`${field} is required`)
  if (clean.length > max) throw new Error(`${field} is longer than ${max} characters`)
  return clean
}
const id = (value, field) => {
  if (typeof value !== 'string' || !/^[a-z]-[a-z0-9]{6,24}$/.test(value)) throw new Error(`${field} is not an id`)
  return value
}
const coord = (value, field) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e6) throw new Error(`${field} is not a number`)
  return Math.round(value)
}
const anchorOf = (a) => {
  if (!a || typeof a !== 'object') return undefined
  const path = typeof a.path === 'string' ? a.path.slice(0, 600) : null
  if (!path) return undefined
  const out = { path, dx: coord(a.dx ?? 0, 'anchor.dx'), dy: coord(a.dy ?? 0, 'anchor.dy') }
  // What the element is and says, to find it again when something put before it moves its path.
  if (typeof a.tag === 'string' && /^[a-z][a-z0-9-]{0,30}$/.test(a.tag)) out.tag = a.tag
  if (typeof a.text === 'string' && a.text.trim()) out.text = a.text.slice(0, 80)
  return out
}

const boxOf = (b) => {
  if (!b || typeof b !== 'object') return undefined
  return { x: coord(b.x, 'box.x'), y: coord(b.y, 'box.y'), w: Math.max(0, coord(b.w, 'box.w')), h: Math.max(0, coord(b.h, 'box.h')) }
}
const refsOf = (list, field) => {
  if (list == null) return undefined
  if (!Array.isArray(list) || list.length > 400) throw new Error(`${field} is not a list`)
  return list.map((v, i) => text(v, LIMITS.frame, `${field}[${i}]`))
}

/** What a client sent, checked and stamped. The server gives the id and the time, so neither
 * can be forged into an order the file did not see. */
export function makeEvent(input, { now = new Date(), newId = randomId } = {}) {
  if (!input || typeof input !== 'object') throw new Error('event is required')
  const at = now.toISOString()
  const name = text(input.name, LIMITS.name, 'name')
  switch (input.op) {
    case 'add': {
      const frame = input.frame == null ? null : text(input.frame, LIMITS.frame, 'frame')
      const event = { op: 'add', id: newId('c'), at, name, text: text(input.text, LIMITS.text, 'text'), frame, x: coord(input.x, 'x'), y: coord(input.y, 'y') }
      const anchor = anchorOf(input.anchor)
      if (anchor) Object.assign(event, { file: text(input.file ?? (frame ?? '').split('#')[0], LIMITS.frame, 'file'), anchor })
      if (input.agent) event.agent = true
      const box = boxOf(input.box)
      if (box) event.box = box
      const about = refsOf(input.items, 'items')
      if (about?.length) event.items = about
      return event
    }
    case 'reply':
      return { op: 'reply', id: newId('r'), to: id(input.to, 'to'), at, name, text: text(input.text, LIMITS.text, 'text') }
    case 'resolve':
      return { op: 'resolve', to: id(input.to, 'to'), at, name, resolved: input.resolved !== false }
    case 'delete':
      return { op: 'delete', to: id(input.to, 'to'), at, name }
    case 'agent':
      return { op: 'agent', to: id(input.to, 'to'), at, name, agent: input.agent !== false }
    default:
      throw new Error('op must be add, reply, resolve, delete or agent')
  }
}

export function randomId(prefix) {
  const bytes = new Uint8Array(9)
  globalThis.crypto.getRandomValues(bytes)
  return `${prefix}-${Array.from(bytes, (b) => (b % 36).toString(36)).join('')}`
}

/** The threads the events describe, oldest first. */
export function foldEvents(events) {
  const threads = new Map()
  const owner = new Map()
  for (const e of events) {
    if (e.op === 'add' && !threads.has(e.id)) {
      threads.set(e.id, { id: e.id, at: e.at, name: e.name, text: e.text, frame: e.frame ?? null, x: e.x, y: e.y, file: e.file ?? null, anchor: e.anchor ?? null, box: e.box ?? null, items: e.items ?? [], agent: !!e.agent, resolved: false, resolvedBy: null, replies: [] })
    } else if (e.op === 'reply' && threads.has(e.to)) {
      threads.get(e.to).replies.push({ id: e.id, at: e.at, name: e.name, text: e.text })
      owner.set(e.id, e.to)
    } else if (e.op === 'resolve' && threads.has(e.to)) {
      const t = threads.get(e.to)
      t.resolved = e.resolved !== false
      t.resolvedBy = t.resolved ? e.name : null
    } else if (e.op === 'agent' && threads.has(e.to)) {
      threads.get(e.to).agent = e.agent !== false
    } else if (e.op === 'delete') {
      if (threads.has(e.to)) threads.delete(e.to)
      else if (owner.has(e.to)) {
        const t = threads.get(owner.get(e.to))
        if (t) t.replies = t.replies.filter((r) => r.id !== e.to)
      }
    }
  }
  return [...threads.values()]
}

/** The board's own objects, the frames moved by hand, the pages and the canvas's name; last line wins. */
export function foldBoard(events) {
  const items = new Map()
  const moved = new Map()
  const pages = new Map()
  const locked = new Set()
  let name = null
  for (const e of events) {
    if (e.op === 'move' && e.key) moved.set(e.key, { x: e.x, y: e.y, page: e.page ?? moved.get(e.key)?.page ?? null })
    else if (e.op === 'item' && e.id) items.set(e.id, { ...(items.get(e.id) ?? {}), ...e })
    else if (e.op === 'remove' && e.id) items.delete(e.id)
    else if (e.op === 'page' && e.id) pages.set(e.id, { ...(pages.get(e.id) ?? { id: e.id }), ...(e.title != null ? { title: e.title } : {}), ...(e.removed != null ? { removed: e.removed } : {}) })
    else if (e.op === 'name' && e.title) name = e.title
    else if (e.op === 'lock' && e.key) e.locked ? locked.add(e.key) : locked.delete(e.key)
  }
  return { items: [...items.values()], moved: Object.fromEntries(moved), pages: [...pages.values()], name, locked: [...locked] }
}

/** A board object's colour: a hex, a colour name, or rgb()/hsl() numbers. Anything else is refused,
 * since the colour is drawn into a style and an SVG. */
const colorOf = (value) => {
  const c = typeof value === 'string' ? value.trim() : ''
  if (c === '' || /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(?:rgb|hsl)a?\([\d.,%\s/]+\))$/i.test(c)) return c
  throw new Error('color is not a colour')
}
const BOARD_KINDS = ['note', 'title', 'rect', 'ellipse', 'section', 'line', 'arrow', 'pencil', 'guide']
const pageId = (value) => {
  if (typeof value !== 'string' || !/^[a-z0-9-]{1,40}$/.test(value)) throw new Error('page is not a page id')
  return value
}

/** A board event a client sent, checked and stamped. */
export function makeBoardEvent(input, { now = new Date(), newId = randomId } = {}) {
  if (!input || typeof input !== 'object') throw new Error('event is required')
  const at = now.toISOString()
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, LIMITS.name) : 'someone'
  switch (input.op) {
    case 'move': {
      const event = { op: 'move', at, name, key: text(input.key, LIMITS.frame, 'key'), x: coord(input.x, 'x'), y: coord(input.y, 'y') }
      if (input.page != null) event.page = pageId(input.page)
      return event
    }
    case 'item': {
      const event = { op: 'item', id: input.id ? id(input.id, 'id') : newId('b'), at, name }
      if (input.kind != null) {
        if (!BOARD_KINDS.includes(input.kind)) throw new Error(`kind must be one of ${BOARD_KINDS.join(', ')}`)
        event.kind = input.kind
      }
      if (input.page != null) event.page = pageId(input.page)
      for (const k of ['x', 'y', 'w', 'h', 'z']) if (input[k] != null) event[k] = coord(input[k], k)
      if (input.text != null) event.text = String(input.text).slice(0, LIMITS.text)
      if (input.color != null) event.color = colorOf(input.color)
      if (input.frame != null) event.frame = text(input.frame, LIMITS.frame, 'frame')
      // An end let go of is written as an empty string, so the fold drops what an earlier line bound.
      for (const k of ['from', 'to']) if (input[k] != null) event[k] = input[k] === '' ? '' : text(input[k], LIMITS.frame, k)
      // Objects grouped together share a group id; an empty string ungroups.
      if (input.group != null) event.group = input.group === '' ? '' : id(input.group, 'group')
      for (const k of ['cols', 'gutter', 'margin']) if (input[k] != null) event[k] = input[k] === '' ? '' : coord(input[k], k)
      // A title's type size, in board pixels; an empty one is the default again.
      if (input.size != null) event.size = input.size === '' ? '' : Math.min(400, Math.max(12, coord(input.size, 'size')))
      if (input.points != null) {
        if (!Array.isArray(input.points) || input.points.length > 4000) throw new Error('points is not a list of numbers')
        event.points = input.points.map((v, i) => coord(v, `points[${i}]`))
      }
      return event
    }
    case 'remove':
      return { op: 'remove', at, name, id: id(input.id, 'id') }
    case 'page': {
      const event = { op: 'page', at, name, id: input.id ? pageId(input.id) : newId('p') }
      if (input.title != null) event.title = text(input.title, LIMITS.frame, 'title')
      if (input.removed != null) event.removed = !!input.removed
      return event
    }
    case 'name':
      return { op: 'name', at, name, title: text(input.title, LIMITS.frame, 'title') }
    case 'lock':
      return { op: 'lock', at, name, key: text(input.key, LIMITS.frame, 'key'), locked: !!input.locked }
    default:
      throw new Error('op must be move, item, remove, page, name or lock')
  }
}
