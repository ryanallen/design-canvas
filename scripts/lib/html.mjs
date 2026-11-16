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
export const untag = (html) => html.replace(/\s+data-cv="\d+"/g, '').replace(/\s+contenteditable="[^"]*"/g, '').replace(/\s+spellcheck="[^"]*"/g, '')

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

/**
 * Apply one edit. Returns the new source and the offset of the element to select afterwards.
 * Every op names elements by `data-cv` offsets taken from the source it is applied to.
 */
export function applyEdit(src, edit) {
  const { byStart } = parse(src)
  const get = (cv) => {
    const el = byStart.get(Number(cv))
    if (!el) throw new Error(`no element at ${cv}; the file changed, reload the frame`)
    return el
  }
  switch (edit.op) {
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
      const html = src.slice(el.start, el.end)
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
      const r = splice(src, at, at, untag(edit.html))
      return { src: r.src, select: at }
    }
    case 'rule': {
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

/** The rules in the canvas's own stylesheet, for the panel to show. */
export const canvasRules = (src) => parseRules(canvasStyle(src).css).map((r) => ({ selector: r.sel, props: Object.fromEntries(r.props) }))
