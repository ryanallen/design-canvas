// A prototype's HTML as a tree of elements with their offsets in the file, and the edits the
// canvas makes to it as replacements at those offsets. Nothing outside the edited range changes,
// so a file's diff shows only the edit.
//
// No parser package: the canvas has to install by copying a folder. The prototypes it edits are
// written by build scripts and browsers, so they are well formed; the few places HTML closes an
// element without saying so (a <p> before a block, a second <li>) are handled, and anything a
// browser invents (a <tbody>) simply has no offset and is shown as not editable.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const RAW = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'noscript'])
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul'])
const SELF = { li: ['li'], dt: ['dt', 'dd'], dd: ['dt', 'dd'], option: ['option'], tr: ['tr', 'td', 'th'], td: ['td', 'th'], th: ['td', 'th'] }

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
export const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
/** Words as they are written into text between tags. */
const escText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** Every element, keyed by the offset of its `<`. */
export function parse(src) {
  const byStart = new Map()
  const root = { tag: '#root', children: [], start: -1 }
  const stack = [root]
  const close = (el, closeStart, end) => {
    el.closeStart = closeStart
    el.end = end
  }
  let i = 0
  const n = src.length
  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt < 0) break
    i = lt
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4)
      i = e < 0 ? n : e + 3
      continue
    }
    if (src[i + 1] === '!' || src[i + 1] === '?') {
      const e = src.indexOf('>', i)
      i = e < 0 ? n : e + 1
      continue
    }
    if (src[i + 1] === '/') {
      const m = /^<\/([A-Za-z][\w:-]*)\s*>/.exec(src.slice(i, i + 200))
      if (!m) {
        i += 2
        continue
      }
      const tag = m[1].toLowerCase()
      let k = stack.length - 1
      while (k > 0 && stack[k].tag !== tag) k--
      if (k > 0) {
        // Anything still open inside it was closed without saying so, where its own content ended.
        for (let j = stack.length - 1; j > k; j--) {
          const el = stack[j]
          close(el, i, i)
        }
        stack.length = k + 1
        const el = stack.pop()
        close(el, i, i + m[0].length)
      }
      i += m[0].length
      continue
    }
    const nm = /^<([A-Za-z][\w:-]*)/.exec(src.slice(i, i + 100))
    if (!nm) {
      i += 1
      continue
    }
    const tag = nm[1].toLowerCase()
    // The start tag's attributes, with their own offsets.
    let j = i + nm[0].length
    const attrs = []
    let selfClose = false
    while (j < n) {
      while (j < n && /\s/.test(src[j])) j++
      if (src[j] === '>') {
        j++
        break
      }
      if (src[j] === '/' && src[j + 1] === '>') {
        selfClose = true
        j += 2
        break
      }
      const a = /^[^\s"'>\/=]+/.exec(src.slice(j, j + 200))
      if (!a) {
        j++
        continue
      }
      const aStart = j
      j += a[0].length
      let value = ''
      let k = j
      while (k < n && /\s/.test(src[k])) k++
      if (src[k] === '=') {
        k++
        while (k < n && /\s/.test(src[k])) k++
        const q = src[k]
        if (q === '"' || q === "'") {
          const e = src.indexOf(q, k + 1)
          value = src.slice(k + 1, e < 0 ? n : e)
          j = e < 0 ? n : e + 1
        } else {
          const u = /^[^\s>]*/.exec(src.slice(k, k + 2000))[0]
          value = u
          j = k + u.length
        }
      }
      attrs.push({ name: a[0].toLowerCase(), value: decode(value), start: aStart, end: j })
    }
    // What HTML closes on its own before this tag opens.
    const top = () => stack[stack.length - 1]
    if (CLOSES_P.has(tag) && top().tag === 'p') {
      const p = stack.pop()
      close(p, i, i)
    }
    if (SELF[tag]) {
      for (let k = stack.length - 1; k > 0; k--) {
        const t = stack[k].tag
        if (SELF[tag].includes(t)) {
          for (let x = stack.length - 1; x >= k; x--) close(stack[x], i, i)
          stack.length = k
          break
        }
        if (['ul', 'ol', 'table', 'tbody', 'thead', 'tfoot', 'select', 'dl', 'div'].includes(t)) break
      }
    }
    const parent = top()
    const el = { tag, start: i, nameEnd: i + nm[0].length, openEnd: j, attrs, parent, children: [] }
    parent.children.push(el)
    byStart.set(i, el)
    if (VOID.has(tag) || selfClose) {
      close(el, j, j)
      i = j
      continue
    }
    if (RAW.has(tag)) {
      const re = new RegExp(`</${tag}\\s*>`, 'ig')
      re.lastIndex = j
      const m = re.exec(src)
      if (m) {
        close(el, m.index, m.index + m[0].length)
        i = m.index + m[0].length
      } else {
        close(el, n, n)
        i = n
      }
      continue
    }
    stack.push(el)
    i = j
  }
  for (let k = stack.length - 1; k > 0; k--) close(stack[k], n, n)
  return { root, byStart }
}

/** The file as the canvas serves it: every element carries `data-cv`, the offset of its `<`. */
export function tag(src) {
  const { byStart } = parse(src)
  const starts = [...byStart.keys()].sort((a, b) => a - b)
  let out = ''
  let at = 0
  for (const s of starts) {
    const el = byStart.get(s)
    out += src.slice(at, el.nameEnd) + ` data-cv="${s}"`
    at = el.nameEnd
  }
  return out + src.slice(at)
}

/** Strips what the canvas added from HTML a browser handed back. */
export const untag = (html) => html.replace(/\s+data-cv="\d+"/g, '').replace(/\s+contenteditable="[^"]*"/g, '').replace(/\s+spellcheck="[^"]*"/g, '').replace(/\s+data-dc-state="[^"]*"/g, '')

export const attr = (el, name) => el.attrs.find((a) => a.name === name)

export function styleMap(text) {
  const map = new Map()
  for (const part of (text || '').split(';')) {
    const c = part.indexOf(':')
    if (c < 0) continue
    const k = part.slice(0, c).trim().toLowerCase()
    const v = part.slice(c + 1).trim()
    if (k) map.set(k, v)
  }
  return map
}
export const styleText = (map) => [...map].map(([k, v]) => `${k}: ${v}`).join('; ')

/** Markup going into a page, with every id the page already has made new (`hero` becomes `hero-2`), so no two elements share one. */
function uniqueIds(src, html) {
  const taken = new Set([...src.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]))
  return html.replace(/(\sid=")([^"]*)(")/g, (_, open, id, close) => {
    if (!taken.has(id)) {
      taken.add(id)
      return open + id + close
    }
    const base = id.replace(/-\d+$/, '')
    let n = 2
    while (taken.has(`${base}-${n}`)) n++
    taken.add(`${base}-${n}`)
    return `${open}${base}-${n}${close}`
  })
}
/** One replacement: the text from `start` to `end` becomes `text`. */
const splice = (src, start, end, text) => ({ src: src.slice(0, start) + text + src.slice(end), start, end, text, removed: src.slice(start, end) })

function setAttr(src, el, name, value) {
  const a = attr(el, name)
  if (value == null || value === '') {
    if (!a) return { src }
    let s = a.start
    while (s > 0 && /\s/.test(src[s - 1])) s--
    return splice(src, s, a.end, '')
  }
  const text = `${name}="${escAttr(value)}"`
  if (a) return splice(src, a.start, a.end, text)
  return splice(src, el.nameEnd, el.nameEnd, ` ${text}`)
}

/** Where the value of custom property `name` sits in a `:root` rule of the prototype's own styles, or null. */
function declaredAt(src, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const s of src.matchAll(/<style\b(?![^>]*\bdata-canvas\b)[^>]*>([\s\S]*?)<\/style>/gi)) {
    const css = s[1]
    const cssAt = s.index + s[0].length - '</style>'.length - css.length
    for (const r of css.matchAll(/(^|[},;\s]):root\s*\{([^}]*)\}/g)) {
      const bodyAt = cssAt + r.index + r[0].length - 1 - r[2].length
      const d = new RegExp(`(^|[;{\\s])${esc}\\s*:\\s*([^;}]*?)(\\s*)(?=;|$)`).exec(r[2])
      if (!d) continue
      const start = bodyAt + d.index + d[0].length - d[3].length - d[2].length
      return { start, end: start + d[2].length }
    }
  }
  return null
}

/** A selector as the browser prints it and as a file may write it, made comparable: one space between parts, none
 *  around combinators and commas. */
const sameSelector = (s) => String(s).replace(/\s+/g, ' ').replace(/\s*([>+~,])\s*/g, '$1').trim()

/**
 * The body of the nth rule (from 0, in file order) whose selector is `selector`, in the prototype's own <style>
 * elements (never the canvas's): where its declarations start and end in the file. Comments are passed over; a rule
 * inside an @media block is found as any other.
 */
/** A rule's body with one declaration changed: its value replaced, added at the end, or taken out when the value is
 *  empty; null when there is nothing to change. */
function declIn(text, prop, value) {
  prop = String(prop).trim().toLowerCase()
  if (!/^-{0,2}[a-z][a-z0-9-]*$/.test(prop)) throw new Error(`not a property: ${prop}`)
  value = String(value ?? '').replace(/[{};<]/g, '').trim()
  const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let last = null
  for (const d of text.matchAll(new RegExp(`(^|[;\\s])(${esc}\\s*:\\s*)([^;]*?)(\\s*)(;|$)`, 'g'))) last = d
  if (last) {
    const declAt = last.index + last[1].length
    const valueAt = declAt + last[2].length
    const valueEnd = valueAt + last[3].length
    if (value) return text.slice(0, valueAt) + value + text.slice(valueEnd)
    // Taken out with its semicolon and the space before it.
    const end = valueEnd + last[4].length + last[5].length
    let from = declAt
    while (from > 0 && /[ \t]/.test(text[from - 1])) from--
    return text.slice(0, from) + text.slice(end)
  }
  if (!value) return null
  const trimmed = text.replace(/\s*$/, '')
  const tail = text.slice(trimmed.length)
  const sep = !trimmed.trim() ? ' ' : trimmed.endsWith(';') ? ' ' : '; '
  return `${trimmed}${sep}${prop}: ${value};${tail || ' '}`
}

/**
 * A stylesheet file's text with one declaration of its nth rule with `selector` changed, as `decl` does in a
 * prototype's own <style>: a sheet several prototypes link changes once, and every one of them follows.
 */
export function cssDecl(css, selector, nth, prop, value) {
  const want = sameSelector(selector)
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length))
  let seen = 0
  for (const r of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (sameSelector(r[1].replace(/^[\s\S]*;/, '')) !== want || seen++ !== (Number(nth) || 0)) continue
    const start = r.index + r[0].length - 1 - r[2].length
    const out = declIn(css.slice(start, start + r[2].length), prop, value)
    return out == null ? css : css.slice(0, start) + out + css.slice(start + r[2].length)
  }
  throw new Error(`no rule ${selector} in the stylesheet`)
}

function ruleBodyAt(src, selector, nth = 0) {
  const want = sameSelector(selector)
  let seen = 0
  for (const s of src.matchAll(/<style\b(?![^>]*\bdata-canvas\b)[^>]*>([\s\S]*?)<\/style>/gi)) {
    const css = s[1].replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length))
    const cssAt = s.index + s[0].length - '</style>'.length - s[1].length
    for (const r of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (sameSelector(r[1]) !== want) continue
      if (seen++ !== nth) continue
      const start = cssAt + r.index + r[0].length - 1 - r[2].length
      return { start, end: start + r[2].length }
    }
  }
  return null
}

function canvasStyle(src) {
  // The canvas's own rules: one <style data-canvas> at the end of <head>, made the first time.
  const m = /<style data-canvas>([\s\S]*?)<\/style>/.exec(src)
  if (m) return { at: m.index + '<style data-canvas>'.length, end: m.index + '<style data-canvas>'.length + m[1].length, css: m[1], made: false }
  const head = src.search(/<\/head>/i)
  const at = head < 0 ? 0 : head
  return { at, end: at, css: '', made: true }
}

function parseRules(css) {
  const rules = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) rules.push({ sel: m[1].trim(), props: styleMap(m[2]) })
  return rules
}
const rulesText = (rules) => `\n${rules.map((r) => `${r.sel} { ${styleText(r.props)} }`).join('\n')}\n`

// ── components: copies of one element that change together ──
// An element carrying `data-component="Name"` is a copy of the component Name. A style, an
// attribute, something put in, removed or duplicated, made anywhere inside one copy, is made at
// the same place in every other copy of that name in the file. Text typed into a copy (`inner`)
// and markup replaced whole (`outer`) stay that copy's own, as do `id`, `data-component` and
// `data-locked`; `only: true` on an edit keeps it to the one copy. A copy may also carry
// `data-variant="Name"` (Figma's variants): a style or attribute then reaches only the copies of
// that same variant (no variant is a variant of its own), while parts added, duplicated or removed
// reach every copy, so the variants keep one structure.
const LINKED = new Set(['style', 'attr', 'insert', 'delete', 'duplicate'])
const OWN_ATTRS = new Set(['id', 'data-component', 'data-variant', 'data-locked', 'data-name'])
const LOOKS = new Set(['style', 'attr'])
const variantOf = (el) => (el?.attrs ? attr(el, 'data-variant')?.value?.trim() ?? '' : '')
const componentName = (el) => (el?.attrs ? attr(el, 'data-component')?.value?.trim() || null : null)
/** The copy an element is in, nearest first: its root and the component's name. */
export function componentOf(el) {
  for (let p = el; p && p.tag !== '#root'; p = p.parent) {
    const name = componentName(p)
    if (name) return { root: p, name }
  }
  return null
}
/** Where an element is inside a copy: the index among its parent's elements at each step down, with the tag expected there. */
const pathIn = (root, el) => {
  const path = []
  for (let p = el; p !== root; p = p.parent) path.unshift([p.parent.children.indexOf(p), p.tag])
  return path
}
const atPath = (root, path) => {
  let el = root
  for (const [i, t] of path) {
    el = el.children[i]
    if (!el || el.tag !== t) return null
  }
  return el
}
/** Every copy of a component in the file. */
export function copiesOfComponent(src, name) {
  return [...parse(src).byStart.values()].filter((el) => componentName(el) === name)
}

/**
 * Apply one edit, and when it is made inside a component's copy, the same edit at the same place in
 * every other copy (see above). Returns the new source, the offset of the element to select
 * afterwards, and `linked`, how many other copies took it.
 */
export function applyEdit(src, edit) {
  const r = applyLinked(src, edit)
  if (!edit.keyframes) return r
  // An edit may carry the @keyframes its animation names: written into the file's own keyframes sheet.
  const k = withKeyframes(r.src, edit.keyframes)
  return { ...r, src: k.src, select: r.select != null && r.select >= k.at ? r.select + k.shift : r.select }
}

/** `@keyframes` by name, one per line, in one `<style data-canvas-keyframes>` at the end of <head>; a name already there is replaced. */
function withKeyframes(src, frames) {
  const m = /<style data-canvas-keyframes>([\s\S]*?)<\/style>\n?/.exec(src)
  const lines = new Map((m ? m[1] : '').split('\n').map((l) => [/^@keyframes ([\w-]+) /.exec(l)?.[1], l]).filter(([n]) => n))
  for (const [name, css] of Object.entries(frames)) {
    if (!/^[a-z][\w-]{0,40}$/i.test(name) || /[<>]/.test(String(css ?? ''))) throw new Error(`bad keyframes ${name}`)
    // null takes a name out, as when the animation that named it is taken off.
    if (css == null) lines.delete(name)
    else lines.set(name, `@keyframes ${name} { ${String(css).replace(/\s*\n\s*/g, ' ').trim()} }`)
  }
  if (!lines.size) return m ? { src: src.slice(0, m.index) + src.slice(m.index + m[0].length), at: m.index, shift: -m[0].length } : { src, at: 0, shift: 0 }
  const block = `<style data-canvas-keyframes>\n${[...lines.values()].join('\n')}\n</style>\n`
  if (m) return { src: src.slice(0, m.index) + block + src.slice(m.index + m[0].length), at: m.index, shift: block.length - m[0].length }
  const at = Math.max(0, src.search(/<\/head>/i))
  return { src: src.slice(0, at) + block + src.slice(at), at, shift: block.length }
}

/**
 * What makes an edit a component's: the component's name, the part's path inside its copy, and the copy's variant;
 * null when the edit is a copy's own (no component, a copy removed or duplicated whole, an own attribute, `only`).
 * Read from the file the edit is made in, before it is made.
 */
export function componentEdit(src, edit) {
  const cvs = [edit.cv].flat()
  if (!LINKED.has(edit.op) || edit.only || cvs.length !== 1 || (edit.op === 'attr' && OWN_ATTRS.has(String(edit.name).toLowerCase()))) return null
  const el = parse(src).byStart.get(Number(cvs[0]))
  const comp = el && componentOf(el)
  if (!comp || (comp.root === el && ['delete', 'duplicate'].includes(edit.op))) return null
  return { name: comp.name, path: pathIn(comp.root, el), variant: variantOf(comp.root) }
}

/**
 * The same edit made at the same place in every copy of a component in another prototype (a header used on many
 * screens): style and attribute changes reach copies of the same variant, parts added or removed reach all; a locked
 * part is skipped. Returns the new source and how many copies it reached.
 */
export function applyComponentEdit(src, link, edit) {
  const targets = copiesOfComponent(src, link.name)
    .filter((r) => !LOOKS.has(edit.op) || variantOf(r) === link.variant)
    .map((r) => atPath(r, link.path)).filter(Boolean)
    .sort((a, b) => b.start - a.start)
  let out = src
  let count = 0
  for (const t of targets) {
    const one = { ...edit, cv: t.start }
    if (lockedFor(out, one, { owner: true })) continue
    out = applyOne(out, one).src
    count++
  }
  return { src: out, count }
}

function applyLinked(src, edit) {
  const cvs = [edit.cv].flat()
  const skip = !LINKED.has(edit.op) || edit.only || cvs.length !== 1 || (edit.op === 'attr' && OWN_ATTRS.has(String(edit.name).toLowerCase()))
  const el = skip ? null : parse(src).byStart.get(Number(cvs[0]))
  const comp = el && componentOf(el)
  // Removing a whole copy, or duplicating one to make another, is that copy's own.
  if (!comp || (comp.root === el && ['delete', 'duplicate'].includes(edit.op))) return applyOne(src, edit)
  const path = pathIn(comp.root, el)
  const outside = (r) => r.end <= comp.root.start || r.start >= comp.root.end
  const sameLook = (r) => !LOOKS.has(edit.op) || variantOf(r) === variantOf(comp.root)
  const targets = [el, ...copiesOfComponent(src, comp.name).filter(outside).filter(sameLook).map((r) => atPath(r, path)).filter(Boolean)]
  // Last in the file first: an edit changes nothing before its own element, so the offsets of
  // the copies still to do hold.
  targets.sort((a, b) => b.start - a.start)
  let out = src
  let select = null
  let linked = 0
  for (const t of targets) {
    const one = { ...edit, cv: t.start }
    if (t !== el && lockedFor(out, one, { owner: true })) continue
    const before = out.length
    const r = applyOne(out, one)
    out = r.src
    if (t === el) select = r.select
    else {
      linked++
      // A copy earlier in the file moves the selection by what it grew or shrank.
      if (select != null && t.start < el.start) select += out.length - before
    }
  }
  return { src: out, select, linked }
}

/**
 * Apply one edit. Returns the new source and the offset of the element to select afterwards.
 * Every op names elements by `data-cv` offsets taken from the source it is applied to.
 */
// A page has one <html>, one <head> and one <body>: none of them is copied, removed, wrapped, unwrapped or moved.
const PAGE_ROOTS = new Set(['html', 'head', 'body'])
const RESHAPES = new Set(['delete', 'duplicate', 'wrap', 'unwrap', 'move'])

function applyOne(src, edit) {
  const { byStart } = parse(src)
  const get = (cv) => {
    const el = byStart.get(Number(cv))
    if (!el) throw new Error(`no element at ${cv}; the file changed, reload the frame`)
    return el
  }
  if (RESHAPES.has(edit.op)) {
    for (const cv of [edit.cv].flat()) {
      const el = byStart.get(Number(cv))
      if (el && PAGE_ROOTS.has(el.tag)) throw new Error(`The page's <${el.tag}> stays one and in its place`)
    }
  }
  switch (edit.op) {
    case 'link': {
      // A stylesheet of the prototype's own folder linked at the end of its head, once (a web font's sheet). The
      // element at `cv` stays selected, moved on by what was put in before it.
      const href = String(edit.href ?? '')
      if (!/^(\.\.\/)*[\w-]+(\/[\w-]+)*\.css$/.test(href)) throw new Error(`a linked sheet must be a .css file in the folder, not ${href}`)
      const out = linkSheet(src, href)
      let at = 0
      while (at < src.length && src.charCodeAt(at) === out.charCodeAt(at)) at++
      const cv = edit.cv == null ? null : Number(edit.cv)
      return { src: out, select: cv == null ? null : cv >= at ? cv + out.length - src.length : cv }
    }
    case 'styles': {
      // Several elements' own styles in one edit (one undo), as when a row of siblings is staggered.
      // Last in the file first, so each one's offset still holds when it is reached.
      const items = [...(edit.items ?? [])].map((it) => ({ ...it, el: get(it.cv) })).sort((a, b) => b.el.start - a.el.start)
      let out = src
      for (const it of items) {
        out = applyOne(out, { op: 'style', cv: it.el.start, props: it.props ?? {} }).src
        // Attributes too, as a copy switched to another variant takes its data-variant with its look.
        for (const [name, value] of Object.entries(it.attrs ?? {})) out = applyOne(out, { op: 'attr', cv: it.el.start, name, value }).src
      }
      const first = Math.min(...items.map((it) => it.el.start))
      return { src: out, select: Number.isFinite(first) ? first : null }
    }
    case 'style': {
      const el = get(edit.cv)
      const a = attr(el, 'style')
      const map = styleMap(a?.value)
      for (const [k, v] of Object.entries(edit.props)) {
        if (v == null || v === '') map.delete(k)
        else map.set(k, String(v))
      }
      const r = setAttr(src, el, 'style', styleText(map))
      return { src: r.src, select: el.start }
    }
    case 'attr': {
      const el = get(edit.cv)
      const r = setAttr(src, el, edit.name, edit.value)
      return { src: r.src, select: el.start }
    }
    case 'inner': {
      const el = get(edit.cv)
      const r = splice(src, el.openEnd, el.closeStart, untag(edit.html))
      return { src: r.src, select: el.start }
    }
    case 'outer': {
      const el = get(edit.cv)
      const r = splice(src, el.start, el.end, untag(edit.html))
      return { src: r.src, select: el.start }
    }
    case 'delete': {
      // Several at once go last first, so the earlier offsets still hold.
      const els = [edit.cv].flat().map(get).sort((a, b) => b.start - a.start)
      let out = src
      for (const el of els) {
        let s = el.start
        let e = el.end
        // Its own line, when it had one.
        const before = out.lastIndexOf('\n', s - 1)
        if (/^\s*$/.test(out.slice(before + 1, s)) && /^[ \t]*\r?\n/.test(out.slice(e))) {
          s = before + 1
          e += /^[ \t]*\r?\n/.exec(out.slice(e))[0].length
        }
        out = out.slice(0, s) + out.slice(e)
      }
      return { src: out, select: els.length === 1 ? els[0].parent?.start ?? null : null }
    }
    case 'duplicate': {
      const el = get(edit.cv)
      const html = uniqueIds(src, src.slice(el.start, el.end))
      // On a line of its own, the copy gets a line of its own, with the file's own line ending.
      const lineStart = src.lastIndexOf('\n', el.start - 1) + 1
      const own = /^[ \t]*$/.test(src.slice(lineStart, el.start)) && /^[ \t]*\r?\n/.test(src.slice(el.end))
      const nl = src[lineStart - 2] === '\r' ? '\r\n' : '\n'
      const indent = own ? `${nl}${src.slice(lineStart, el.start)}` : ''
      const r = splice(src, el.end, el.end, indent + html)
      return { src: r.src, select: el.end + indent.length }
    }
    case 'move': {
      // Put the element before or after another one, or last inside it.
      const el = get(edit.cv)
      const target = get(edit.target)
      if (target.start >= el.start && target.end <= el.end) throw new Error('an element cannot go inside itself')
      const html = src.slice(el.start, el.end)
      const at = edit.where === 'before' ? target.start : edit.where === 'inside' ? target.closeStart : target.end
      if (at > el.start && at < el.end) throw new Error('an element cannot go inside itself')
      let out
      let sel
      if (at <= el.start) {
        out = src.slice(0, at) + html + src.slice(at, el.start) + src.slice(el.end)
        sel = at
      } else {
        out = src.slice(0, el.start) + src.slice(el.end, at) + html + src.slice(at)
        sel = at - (el.end - el.start)
      }
      return { src: out, select: sel }
    }
    case 'wrap': {
      // Group: the selected siblings, and everything between them, inside one new element.
      const els = [edit.cv].flat().map(get).sort((a, b) => a.start - b.start)
      const parent = els[0].parent
      if (els.some((e) => e.parent !== parent)) throw new Error('only elements side by side in one parent group together')
      const first = els[0]
      const last = els[els.length - 1]
      const style = edit.style ? ` style="${escAttr(edit.style)}"` : ''
      const open = `<${edit.tag || 'div'}${edit.name ? ` data-name="${escAttr(edit.name)}"` : ''}${style}>`
      const out = src.slice(0, first.start) + open + src.slice(first.start, last.end) + `</${edit.tag || 'div'}>` + src.slice(last.end)
      return { src: out, select: first.start }
    }
    case 'unwrap': {
      const el = get(edit.cv)
      if (!el.children.length && el.closeStart === el.openEnd) throw new Error('nothing inside to keep')
      const out = src.slice(0, el.start) + src.slice(el.openEnd, el.closeStart) + src.slice(el.end)
      return { src: out, select: el.children[0] ? el.start + (el.children[0].start - el.openEnd) : null }
    }
    case 'insert': {
      // New markup, last inside an element, or before or after it.
      const el = get(edit.cv)
      const at = edit.where === 'before' ? el.start : edit.where === 'after' ? el.end : el.closeStart
      const r = splice(src, at, at, uniqueIds(src, untag(edit.html)))
      return { src: r.src, select: at }
    }
    case 'replaceText': {
      // Every place the words appear in the page's text, any case, become the new words, in the case of the words
      // they replace (inCaseOf). Only text
      // between tags changes: never a tag, an attribute, a comment, a script or style, or a locked part.
      const find = escText(String(edit.find ?? ''))
      if (!find) throw new Error('nothing to find')
      const { byStart } = parse(src)
      const skip = [...byStart.values()].filter((e) => RAW.has(e.tag) || e.attrs.some((a) => a.name === 'data-locked')).map((e) => [e.start, e.end])
      const body = [...byStart.values()].find((e) => e.tag === 'body')
      const from = body ? body.openEnd : 0
      const to = body ? body.closeStart : src.length
      const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      let out = ''
      let at = 0
      let count = 0
      for (const m of src.matchAll(/<!--[\s\S]*?-->|<[^>]*>/g)) {
        out += swap(src.slice(at, m.index), at) + m[0]
        at = m.index + m[0].length
      }
      out += swap(src.slice(at), at)
      function swap(text, start) {
        if (start + text.length <= from || start >= to || skip.some(([s, e]) => start >= s && start < e)) return text
        return text.replace(re, (m) => (count++, escText(inCaseOf(m, String(edit.with ?? '')))))
      }
      return { src: out, select: edit.cv ?? null, count }
    }
    case 'decl': {
      // One declaration of a rule in the prototype's own stylesheet, changed where it is written, so every element
      // the rule matches follows: its value replaced, added at the end of the rule, or taken out when empty.
      const body = ruleBodyAt(src, edit.selector, Number(edit.nth) || 0)
      if (!body) throw new Error(`no rule ${edit.selector} in the prototype's own stylesheet`)
      const text = src.slice(body.start, body.end)
      const out = declIn(text, edit.prop, edit.value)
      if (out == null) return { src, select: edit.cv == null ? null : Number(edit.cv) }
      const shift = out.length - text.length
      const sel = edit.cv == null ? null : Number(edit.cv) >= body.end ? Number(edit.cv) + shift : Number(edit.cv)
      return { src: src.slice(0, body.start) + out + src.slice(body.end), select: sel }
    }
    case 'rule': {
      // A variable the prototype declares in its own :root (a lever) changes where it is declared, so
      // the file keeps one value for it; any override of it in the canvas's stylesheet is dropped.
      if (edit.selector === ':root' && edit.cv == null) {
        const props = { ...edit.props }
        for (const [k, v] of Object.entries(edit.props)) {
          if (!k.startsWith('--') || v == null || v === '') continue
          const at = declaredAt(src, k)
          if (!at) continue
          src = src.slice(0, at.start) + String(v).replace(/\s*!important$/, '') + src.slice(at.end)
          props[k] = ''
        }
        edit = { ...edit, props }
        if (!canvasStyle(src).css && Object.values(props).every((v) => v == null || v === '')) return { src, select: null }
      }
      // A rule in the canvas's own stylesheet: every element the selector matches changes at once.
      const box = canvasStyle(src)
      const rules = parseRules(box.css)
      let rule = rules.find((r) => r.sel === edit.selector)
      if (!rule) rules.push((rule = { sel: edit.selector, props: new Map() }))
      for (const [k, v] of Object.entries(edit.props)) {
        if (v == null || v === '') rule.props.delete(k)
        else rule.props.set(k, `${String(v).replace(/\s*!important$/, '')} !important`)
      }
      const kept = rules.filter((r) => r.props.size)
      const css = rulesText(kept)
      const out = box.made ? src.slice(0, box.at) + `<style data-canvas>${css}</style>\n` + src.slice(box.at) : src.slice(0, box.at) + css + src.slice(box.end)
      const shift = box.made ? `<style data-canvas>${css}</style>\n`.length : css.length - box.css.length
      const sel = edit.cv == null ? null : Number(edit.cv) >= box.at ? Number(edit.cv) + shift : Number(edit.cv)
      return { src: out, select: sel }
    }
    default:
      throw new Error(`unknown edit ${edit.op}`)
  }
}

/**
 * New words in the case of the words they replace, as a find-and-replace that keeps case: "Swell" → "Surf",
 * "SWELL" → "SURF", "swell" → "surf". New words typed with a capital of their own are put as typed.
 */
export function inCaseOf(found, put) {
  if (put !== put.toLowerCase()) return put
  const letters = found.replace(/[^\p{L}]/gu, '')
  if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return put.toUpperCase()
  const first = found.match(/\p{L}/u)?.[0]
  if (first && first !== first.toLowerCase()) return put.replace(/\p{L}/u, (c) => c.toUpperCase())
  return put
}

/**
 * Why an edit may not be made, or null. An element carrying `data-locked` is locked with everything
 * inside it: nothing in it changes, it is not moved, removed or wrapped, nothing is put into it, and
 * nothing that holds it is retyped, replaced, removed or unwrapped. Turning a lock on or off is an
 * edit of its own, made only by the owner (`{ owner: true }`: served by node, or the folder on disk),
 * who is otherwise held to the locks like anyone. Styling or setting another attribute on an element that holds a locked one
 * changes only that element, so it is allowed; so is a rule.
 */
export function lockedFor(src, edit, { owner = false } = {}) {
  const { byStart } = parse(src)
  const isLocked = (el) => !!el?.attrs && el.attrs.some((a) => a.name === 'data-locked')
  const within = (el) => {
    for (let p = el; p && p.tag !== '#root'; p = p.parent) if (isLocked(p)) return true
    return false
  }
  const holds = (el) => (el.children ?? []).some((c) => isLocked(c) || holds(c))
  const els = (cv) => [cv].flat().filter((v) => v != null).map((v) => byStart.get(Number(v))).filter(Boolean)
  const SAY = 'That part is locked.'
  if (edit.op === 'rule' || edit.op === 'decl') return null
  if (edit.op === 'attr' && edit.name === 'data-locked') return owner ? null : 'Only the owner locks and unlocks.'
  if (edit.op === 'styles') {
    if (!owner && (edit.items ?? []).some((it) => Object.keys(it.attrs ?? {}).some((n) => n.toLowerCase() === 'data-locked'))) return 'Only the owner locks and unlocks.'
    return els((edit.items ?? []).map((it) => it.cv)).some(within) ? SAY : null
  }
  const targets = els(edit.cv)
  if (targets.some(within)) return SAY
  switch (edit.op) {
    case 'style':
    case 'attr':
    case 'insert':
    case 'link':
      return null
    case 'move': {
      if (targets.some(holds)) return SAY
      const target = byStart.get(Number(edit.target))
      if (target && (edit.where === 'inside' ? within(target) : within(target.parent))) return SAY
      return null
    }
    default:
      // inner, outer, delete, duplicate, wrap, unwrap: what holds a locked element would change, copy or drop it.
      return targets.some(holds) ? SAY : null
  }
}

/** The rules in the canvas's own stylesheet, for the panel to show. */
export const canvasRules = (src) => parseRules(canvasStyle(src).css).map((r) => ({ selector: r.sel, props: Object.fromEntries(r.props) }))

/** `html` with a link to `href` at the end of its head, unless it links it already. */
export function linkSheet(html, href) {
  const esc = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`<link\\b[^>]*href=["']${esc}["']`, 'i').test(html)) return html
  const tag = `<link rel="stylesheet" href="${href}">`
  const head = /<\/head\s*>/i.exec(html)
  if (head) {
    const lineStart = html.lastIndexOf('\n', head.index) + 1
    const before = html.slice(lineStart, head.index)
    // On a line of its own, the link goes on the line above, indented one step in; else just before </head>.
    if (/^[ \t]*$/.test(before)) return `${html.slice(0, lineStart)}${before}  ${tag}\n${html.slice(lineStart)}`
    return `${html.slice(0, head.index)}${tag}${html.slice(head.index)}`
  }
  const body = /<body\b/i.exec(html)
  return body ? `${html.slice(0, body.index)}${tag}\n${html.slice(body.index)}` : `${tag}\n${html}`
}
