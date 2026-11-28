// The board: pages of prototypes laid out live, pan and zoom, frame headers, comments pinned to
// elements, the whiteboard (notes, titles, shapes with text, sections, lines and arrows that hold
// on to what they join, pencil, layout guides, a selection box), the window's chrome and
// Present. Runs after lib/events.mjs, inlined above it with its exports stripped, so parseLines,
// foldEvents, foldBoard and LIMITS are in scope. The editor (editor.js) runs after it and works
// through `window.designCanvas`.
;(() => {
  // What the page looked like as built, before anything here touched it: what Download gives
  // when the canvas was opened from disk. The lines after this script are added once parsed.
  let asBuilt = `<!doctype html>\n${document.documentElement.outerHTML}`
  const data = JSON.parse(document.getElementById('rc-data').textContent)
  const web = location.protocol === 'http:' || location.protocol === 'https:'
  let serve = !!data.serve && web
  // This tab's own id, sent with every /api/ call to this site, so the server's Ctrl+Z takes back this person's
  // changes alone and not someone else's made since.
  const tabId = (() => {
    const make = () => Math.random().toString(36).slice(2, 12)
    try {
      let t = sessionStorage.getItem('dc-tab')
      if (!t) sessionStorage.setItem('dc-tab', (t = make()))
      return t
    } catch { return make() }
  })()
  {
    const plain = window.fetch.bind(window)
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : input?.url ?? ''
      if (/^\/api\//.test(url.startsWith(location.origin) ? url.slice(location.origin.length) : url)) {
        const headers = new Headers(init.headers || {})
        headers.set('x-dc-client', tabId)
        init = { ...init, headers }
      }
      return plain(input, init)
    }
  }
  let local = false
  // A visitor to a published copy in play mode: edits, but never locks or unlocks.
  let visitor = false
  const $ = (sel, el = document) => el.querySelector(sel)
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue
      if (k === 'class') el.className = v
      else if (k === 'html') el.innerHTML = v
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
      else el.setAttribute(k, v === true ? '' : v)
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid)
    return el
  }
  const s = (tag, attrs = {}, ...kids) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
    for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v)
    el.append(...kids)
    return el
  }
  const store = {
    get(key) {
      try { return JSON.parse(localStorage.getItem(`dc:${data.key}:${key}`)) } catch { return null }
    },
    set(key, value) {
      try { localStorage.setItem(`dc:${data.key}:${key}`, JSON.stringify(value)) } catch {}
    },
  }
  const ICONS = {
    select: '<path d="M4 2.5l8.5 5.2-3.8.9 2.2 4.1-1.6.8-2.2-4.1L4.5 12z" fill="currentColor" stroke="none"/>',
    hand: '<path d="M5.5 8V3.5a1 1 0 012 0V7m0-3.5v-1a1 1 0 012 0V7m0-3a1 1 0 012 0v3.5m0-2a1 1 0 012 0V10a4.5 4.5 0 01-4.5 4.5h-.6a4 4 0 01-3.2-1.6L2.7 10a1 1 0 011.5-1.3L5.5 10" stroke-linecap="round" stroke-linejoin="round"/>',
    text: '<path d="M3 4V2.5h10V4M8 2.5v11M6 13.5h4" stroke-linecap="round" stroke-linejoin="round"/>',
    artboard: '<path d="M5 1.5v13M11 1.5v13M1.5 5h13M1.5 11h13" stroke-linecap="round"/>',
    note: '<path d="M2.5 2.5h11v7l-4 4h-7z M13.5 9.5h-4v4" stroke-linejoin="round"/>',
    pencil: '<path d="M10.5 2.5l3 3-8 8H2.5v-3z M9 4l3 3" stroke-linejoin="round"/>',
    stamp: '<path d="M6 2.5h4v3.5l-.8 2.5H13.5v2.5h-11V8.5h4.3L6 6z M3 13.5h10" stroke-linejoin="round" stroke-linecap="round"/>',
    rect: '<rect x="2.5" y="3.5" width="11" height="9" rx="1"/>',
    ellipse: '<ellipse cx="8" cy="8" rx="5.8" ry="4.8"/>',
    diamond: '<path d="M8 2l6 6-6 6-6-6z" stroke-linejoin="round"/>',
    triangle: '<path d="M8 2.5l6 10.5H2z" stroke-linejoin="round"/>',
    line: '<path d="M3 13L13 3" stroke-linecap="round"/>',
    arrow: '<path d="M3 13L13 3M7 3h6v6" stroke-linecap="round" stroke-linejoin="round"/>',
    guide: '<path d="M2.5 2.5h11v11h-11z M6 2.5v11 M10 2.5v11" stroke-linejoin="round"/>',
    section: '<path d="M2.5 5.5h11v8h-11z M2.5 5.5v-3h5v3" stroke-linejoin="round"/>',
    comment: '<path d="M3 3h10v7H7l-3 3v-3H3z" stroke-linejoin="round"/>',
    panel: '<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M10 2.5v11"/>',
    download: '<path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10" stroke-linecap="round" stroke-linejoin="round"/>',
    full: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" stroke-linecap="round" stroke-linejoin="round"/>',
    eye: '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" stroke-linejoin="round"/><circle cx="8" cy="8" r="2"/>',
    eyeOff: '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" stroke-linejoin="round"/><path d="M2.5 13.5l11-11" stroke-linecap="round"/>',
    tweaks: '<path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" stroke-linecap="round"/><circle cx="10" cy="4.5" r="1.5"/><circle cx="6" cy="11.5" r="1.5"/>',
    lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>',
    unlock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 014.9-.7"/>',
    link: '<path d="M7 9a2.5 2.5 0 003.5 0l2-2a2.5 2.5 0 00-3.5-3.5l-.7.7M9 7a2.5 2.5 0 00-3.5 0l-2 2A2.5 2.5 0 007 12.5l.7-.7" stroke-linecap="round"/>',
  }
  const icon = (name) => h('span', { class: 'ico', html: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">${ICONS[name] ?? ''}</svg>` })
  for (const el of document.querySelectorAll('[data-icon]')) el.replaceWith(Object.assign(icon(el.dataset.icon), { className: el.className }))

  const hooks = {}
  const call = (name, ...args) => (typeof hooks[name] === 'function' ? hooks[name](...args) : undefined)

  // The lines this file was built with are its own comment nodes. Reading nodes rather than the
  // page source keeps anything inside a script from ever reading as a line.
  const ownLines = (kind) => {
    const walk = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT)
    const found = []
    const prefix = `${kind} `
    while (walk.nextNode()) {
      const text = walk.currentNode.data.trim()
      if (!text.startsWith(prefix)) continue
      try {
        const event = JSON.parse(text.slice(prefix.length))
        if (event && typeof event.op === 'string') found.push(event)
      } catch {}
    }
    return found
  }
  // The lines sit after this script in the file, so they are read once the page is parsed.
  let boardEvents = []
  /** The board the lines say, with each stamp at its place on the object it sits on, wherever that object now is. */
  function foldPlaced(events) {
    return placeStamps(foldBoard(events))
  }
  /** Each stamp put at its place on what it sits on, as that is now (also while moves are drawn ahead of saving). */
  function placeStamps(b) {
    const byId = new Map(b.items.map((i) => [i.id, i]))
    for (const it of b.items) {
      const on = it.kind === 'stamp' && it.to ? byId.get(it.to) : null
      if (on && on.kind !== 'stamp' && on.x != null) Object.assign(it, { x: on.x + (Number(it.dx) || 0), y: on.y + (Number(it.dy) || 0), ...(on.page ? { page: on.page } : {}) })
    }
    return b
  }
  let board = foldPlaced(boardEvents)
  let editLines = []

  // ── files: each prototype is stored once and written into its frames as srcdoc ──
  // Not a blob URL: a page opened from disk may not frame its own blobs in Chrome, and srcdoc
  // works the same from a disk or a server. A shared stylesheet goes in as a <style>.
  const fileHtml = {}
  const withAssets = (file) => {
    if (!fileHtml[file]) {
      // Each sheet named by its file, so the Code tab can tell a shared sheet's rules from the prototype's own.
      fileHtml[file] = data.files[file].replace(/<link\b[^>]*__RC_ASSET__\(([^)]+)\)[^>]*>/g, (_, a) => (data.assets[a] ? `<style data-dc-sheet="${a.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">${data.assets[a].text}</style>` : ''))
    }
    return fileHtml[file]
  }
  /** The prototype as a file of its own: what Download gives, with nothing the canvas added. */
  const plainFile = (file) => withAssets(file).replace(/\s+data-cv="\d+"/g, '').replace(/\s+data-dc-v="[^"]*"/, '')
  /** What a frame draws: the file, the screen it shows, and the script that turns its links into moves on the board. */
  const docFor = (f) => {
    const html = withAssets(f.file)
    // A srcdoc document has no address of its own, so it cannot be opened at a fragment, and a
    // fragment link inside it would navigate it away to nothing. So the screen is shown by a rule
    // that outranks the prototype's own router, and a click on a fragment link moves that rule.
    // A link to another prototype is handed to the canvas, which opens that prototype.
    const id = (f.hash || '').replace(/[^\w-]/g, '')
    const rule = id ? `.screen-page{display:none!important}.screen-page[id="${id}"]{display:block!important}` : ''
    const go = `<style id="rc-screen">${rule}</style><script>document.addEventListener('click',(e)=>{const a=e.target.closest&&e.target.closest('a[href]');if(!a||e.defaultPrevented)return;const href=a.getAttribute('href');if(href.startsWith('#')){e.preventDefault();const id=decodeURIComponent(href.slice(1));const t=id?document.getElementById(id):document.querySelector('.screen-page.is-start');if(!t)return;if(t.classList.contains('screen-page')){document.getElementById('rc-screen').textContent='.screen-page{display:none!important}#'+CSS.escape(t.id)+'{display:block!important}';scrollTo(0,0)}else t.scrollIntoView();return}if(/^[^:?]+\\.html(#.*)?$/i.test(href)){e.preventDefault();parent.postMessage({dc:'go',href},'*')}})</script>`
    const cut = f.crop ? `<script>addEventListener('DOMContentLoaded',()=>(${data.crop})(${JSON.stringify(f.crop)}))</script>` : ''
    // Nor can it take an address in history.replaceState or pushState (a prototype keeping its state in a #), which
    // throws there and stops the prototype's handler half way; the state is kept and the address left as it is, and
    // pushState replaces, so a screen adds nothing to the canvas tab's Back. Its own Back (history.back, or go with a
    // step back) would take the canvas tab back, off the canvas: it is asked of the canvas instead, which in Play goes
    // back to the screen played before, as Figma's Navigate back. First in <head>, before its own scripts.
    const hist = `<script>{const h=History.prototype,r=h.replaceState;h.replaceState=function(s,t,u){try{return r.call(this,s,t,u)}catch(e){return r.call(this,s,t)}};h.pushState=function(s,t,u){return h.replaceState.call(this,s,t,u)};h.back=function(){parent.postMessage({dc:'back'},'*')};const g=h.go;h.go=function(n){if(n<0)parent.postMessage({dc:'back'},'*');else if(!n)g.call(this,0)};h.forward=function(){}}</script>`
    const top = html.match(/<head\b[^>]*>/i)
    const withHist = top ? html.slice(0, top.index + top[0].length) + hist + html.slice(top.index + top[0].length) : html
    const at = withHist.search(/<\/head>/i)
    return at < 0 ? (top ? '' : hist) + go + cut + withHist : withHist.slice(0, at) + (top ? '' : hist) + go + cut + withHist.slice(at)
  }
  const save = (name, text, type = 'text/html') => {
    const a = h('a', { href: URL.createObjectURL(text instanceof Blob ? text : new Blob([text], { type })), download: name })
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  }
  const downloadFile = (file) => save(file, plainFile(file))

  // ── pages and layout ──
  // A section is a run of groups; a group that compares options is stacked: the option's letter,
  // title and what is said about it, its main screen at full size, and everything else under it at
  // half size beside that. A frame's w and h are the page it draws; W and H, its size on the board.
  const GAP = 160
  const ROW = 8
  const PAD = 120
  const HEAD = 420
  const SUB = (f) => Math.min(1, 720 / f.w)
  const SUB_COLS = 3
  const SUB_GAP_X = 140
  const SUB_GAP_Y = 340
  const GROUP_GAP = 360
  const SECTION_GAP = 1400
  const MIN_H = 480
  const MAX_H = 4800

  const pages = () => {
    const list = data.pages.map((p) => ({ id: p.id, title: p.title, sections: p.sections }))
    for (const p of board.pages) {
      const known = list.find((x) => x.id === p.id)
      if (known) Object.assign(known, p.title ? { title: p.title } : {}, p.removed != null ? { removed: p.removed } : {}, p.order != null ? { order: p.order } : {})
      else list.push({ id: p.id, title: p.title || 'Untitled', sections: [], removed: !!p.removed, order: p.order })
    }
    // A page moved up or down carries its place; the others keep the place they fall in.
    const rank = (p, i) => p.order ?? i
    return list.map((p, i) => [p, rank(p, i)]).sort((a, b) => a[1] - b[1]).map(([p]) => p).filter((p) => !p.removed)
  }
  let pageId = null
  const allFrames = new Map()
  let boxes = []
  const heights = {}
  const frameKey = (f) => f.file + (f.hash ? `#${f.hash}` : '') + (f.crop ? `@${f.crop}` : '')

  /** Every frame of every page placed: the layout first, then whatever was moved by hand. */
  function layoutAll() {
    boxes = []
    const seen = new Set()
    const place = (f, page, section, x, y, s) => {
      // The same screen may sit on more than one page (a summary page shows screens the rounds
      // already hold). The first keeps the plain key, so comments and moves made on it still find
      // it; each later one is its own frame, keyed with its page.
      let key = frameKey(f)
      if (seen.has(key)) key = `${key}~${page}`
      f._key = key
      seen.add(key)
      const frame = allFrames.get(key) ?? { ...f, key }
      const hgt = heights[key] ?? f.h ?? 1000
      Object.assign(frame, { page, section, x, y, s, h: hgt, w: f.w ?? 1440, W: Math.round((f.w ?? 1440) * s), H: Math.round(hgt * s), meta: data.meta?.[f.file] ?? {} })
      allFrames.set(key, frame)
      return frame
    }
    const grid = (list, x0, y0, s, cols, gapX, gapY, page, section) => {
      let x = x0
      let yy = y0
      let rowH = 0
      let right = x0
      list.forEach((f, i) => {
        if (i && i % cols === 0) {
          yy += rowH + gapY
          x = x0
          rowH = 0
        }
        const fr = place(f, page, section, x, yy, typeof s === 'function' ? s(f) : s)
        x += fr.W + gapX
        right = Math.max(right, x - gapX)
        rowH = Math.max(rowH, fr.H)
      })
      return { right, bottom: yy + rowH }
    }
    for (const page of data.pages) {
      let y = 0
      for (const section of page.sections) {
        section.bounds = { x: 0, y }
        section.page = page.id
        for (const group of section.groups) {
          if (group.kind === 'flat') {
            const end = grid(group.frames, 0, y, 1, ROW, GAP, GAP + 260, page.id, section)
            y = end.bottom + GROUP_GAP
            continue
          }
          const top = y
          const body = top + PAD + (group.kind === 'option' ? HEAD : 160)
          let right = PAD + 1440
          let bottom = body
          group.rule = null
          group.subAt = null
          if (group.kind === 'option') {
            const [main, ...under] = group.frames
            let subX = PAD
            if (main) {
              const fr = place(main, page.id, section, PAD, body, 1)
              right = Math.max(right, fr.x + fr.W)
              bottom = fr.y + fr.H
              subX = fr.x + fr.W + PAD * 2
              group.rule = under.length ? subX - PAD : null
            } else bottom = body + 120
            if (under.length) {
              group.subAt = { x: subX, y: body }
              const end = grid(under, subX, body + 120, SUB, SUB_COLS, SUB_GAP_X, SUB_GAP_Y, page.id, section)
              right = Math.max(right, end.right)
              bottom = Math.max(bottom, end.bottom)
            }
          } else {
            const end = grid(group.frames, PAD, body, SUB, 4, SUB_GAP_X, SUB_GAP_Y, page.id, section)
            right = Math.max(right, end.right)
            bottom = end.bottom
          }
          boxes.push({ page: page.id, group, x: 0, y: top, w: right + PAD, h: bottom + PAD - top })
          y = bottom + PAD + GROUP_GAP
        }
        y += SECTION_GAP - GROUP_GAP
      }
    }
    const first = data.pages[0]?.id ?? 'p1'
    for (const f of data.loose ?? []) place(f, first, null, 0, 0, 1)
    for (const key of [...allFrames.keys()]) if (!seen.has(key)) allFrames.delete(key)
    // Where the layout put each frame, for undoing a frame's first move by hand.
    for (const f of allFrames.values()) f.home = { x: f.x, y: f.y, page: f.page }
    // Frames moved by hand, onto another spot or another page.
    for (const [key, m] of Object.entries(board.moved)) {
      const f = allFrames.get(key)
      if (!f) continue
      f.x = m.x
      f.y = m.y
      if (m.page) f.page = m.page
      f.movedByHand = true
    }
  }
  const frames = () => [...allFrames.values()].filter((f) => f.page === pageId)
  const findFrame = (key) => allFrames.get(key) ?? [...allFrames.values()].find((f) => f.key.startsWith(`${key}@`)) ?? null

  // ── drawing a page ──
  const world = $('#world')
  const overlay = $('#overlay')
  let sectionEls = []
  const itemLayer = h('div', { class: 'items' })
  // Sections sit under the frames, so a prototype inside one is still clicked as a prototype.
  const sectionLayer = h('div', { class: 'items sections' })
  const pinLayer = h('div', { class: 'pins' })
  // Flows, as Figma's prototype connections: an arrow from each link in a screen to the screen it opens.
  const flowLayer = s('svg', { class: 'flows', overflow: 'visible' },
    s('defs', {}, s('marker', { id: 'flow-head', viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse' }, s('path', { d: 'M0 0L10 5L0 10z' }))))
  let flowsOn = store.get('flows') === true
  function drawFlows() {
    flowLayer.querySelectorAll('g').forEach((g) => g.remove())
    if (!flowsOn) return
    const here = frames()
    for (const f of here) {
      if (!f.doc?.body) continue
      for (const a of f.doc.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href')
        if (!/^[^:?#]+\.html(#.*)?$/i.test(href)) continue
        const [file, hash = ''] = href.replace(/^\.\//, '').split('#')
        const to = here.find((x) => x.file === file && (x.hash || '') === hash) ?? here.find((x) => x.file === file)
        if (!to || to === f) continue
        const r = a.getBoundingClientRect()
        if (!r.width && !r.height) continue
        // Up from the link, over the tops of the screens, and down onto the top edge of the one it opens, each
        // arrow a little higher than the last, so none crosses a screen's content or lies on another arrow.
        const n = flowLayer.querySelectorAll('g').length
        const x1 = f.x + (r.left + r.width / 2) * f.s
        const y1 = f.y + r.top * f.s
        const x2 = to.x + Math.min(160, to.W / 4) + (n % 4) * 24
        const y2 = to.y - 6
        const over = Math.min(f.y, to.y) - 420 - n * 160
        flowLayer.append(s('g', {},
          s('circle', { cx: x1, cy: f.y + (r.top + r.height / 2) * f.s, r: 7 }),
          s('path', { d: `M${x1} ${y1}C${x1} ${over} ${x2} ${over} ${x2} ${y2}`, 'marker-end': 'url(#flow-head)' })))
      }
    }
  }
  function toggleFlows() {
    flowsOn = !flowsOn
    store.set('flows', flowsOn)
    drawFlows()
    hint(flowsOn ? 'Flows shown: each link to the screen it opens' : 'Flows hidden', 1600)
  }

  function renderPage() {
    for (const f of allFrames.values()) {
      f.el?.remove()
      f.labelEl?.remove()
      f.edgeEl?.remove()
      // Its document goes with its iframe: one kept would be read as the screen (its version sent with an edit, its
      // elements measured) after the file had changed, and its window is gone.
      f.el = f.labelEl = f.iframe = f.doc = null
      f.loaded = false
    }
    world.replaceChildren()
    sectionEls = []
    drawGroups()
    world.append(sectionLayer)
    for (const f of frames()) drawFrame(f)
    world.append(itemLayer, flowLayer, pinLayer)
    renderItems()
    renderPins()
    $('#page-name').textContent = pages().find((p) => p.id === pageId)?.title ?? ''
    $('#page-count').textContent = String(pages().length)
    samePageName()
    stackLabels()
    updateSub()
    // The frames were drawn empty: the ones in view load now, not at the next pan or zoom.
    loadVisible()
    call('onPage', pageId)
  }
  function drawGroups() {
    for (const el of sectionEls) el.remove()
    sectionEls = []
    const page = data.pages.find((p) => p.id === pageId)
    for (const section of page?.sections ?? []) {
      if (!section.groups.some((g) => g.frames.some((f) => allFrames.get(f._key ?? frameKey(f))?.page === pageId))) continue
      sectionEls.push(h('div', { class: 'label section-label', title: section.sub ? `${section.title} · ${section.sub}` : section.title, style: `left:${section.bounds.x}px;top:${section.bounds.y}px;--w:${section.bounds.w}` }, h('span', { class: 'name' }, section.title), section.sub ? h('small', {}, section.sub) : null))
    }
    for (const { page: p, group: g, x, y, w, h: ht } of boxes) {
      if (p !== pageId) continue
      const option = g.kind === 'option'
      const under = option ? g.frames.length - 1 : 0
      sectionEls.push(h('div', { class: `group${option ? ' option' : ' other'}${g.recommended ? ' recommended' : ''}`, style: `left:${x}px;top:${y}px;width:${w}px;height:${ht}px` },
        h('div', { class: 'group-head', style: `left:${PAD}px;top:${PAD}px;width:${Math.max(1440, w - PAD * 2)}px` },
          option
            ? [
                h('div', { class: 'group-title' }, h('span', { class: 'letter' }, g.letter), h('span', {}, g.title || `Option ${g.letter}`), g.recommended ? h('span', { class: 'chip' }, 'Recommended') : null),
                g.info ? h('p', { class: 'group-info' }, g.info) : null,
                g.frames.length ? null : h('p', { class: 'group-info empty' }, 'Nothing drawn for this option.'),
              ]
            : h('div', { class: 'group-title' }, h('span', {}, g.title))),
        g.rule != null ? h('div', { class: 'group-rule', style: `left:${g.rule}px;top:${PAD + HEAD}px;bottom:${PAD}px` }) : null,
        g.subAt ? h('div', { class: 'group-sub', style: `left:${g.subAt.x}px;top:${g.subAt.y - y}px` }, `Under option ${g.letter} · ${under} screen${under === 1 ? '' : 's'}`) : null))
    }
    world.prepend(...sectionEls)
  }
  function drawFrame(f) {
    f.el = h('div', { class: 'frame', 'data-key': f.key }, h('div', { class: 'placeholder' }, f.label))
    const m = f.meta
    f.labelEl = h('div', { class: 'label frame-label', 'data-key': f.key },
      h('span', { class: 'name', title: `${f.key} · drag to move` }, f.label),
      serve && !f.crop ? h('button', { type: 'button', class: 'width', title: 'Width on the board', onclick: (e) => { e.stopPropagation(); widthMenu(e.currentTarget, f) } }, String(f.w)) : null,
      h('button', { type: 'button', title: 'Download this prototype', onclick: (e) => { e.stopPropagation(); downloadFile(f.file) } }, icon('download')),
      h('button', { type: 'button', title: 'Full screen', onclick: (e) => { e.stopPropagation(); openPlay(f, 'fill') } }, icon('full')),
      m.levers?.length ? h('button', { type: 'button', title: 'Tweaks', onclick: (e) => { e.stopPropagation(); call('onTweaks', f); openPanel('tweaks') } }, icon('tweaks')) : null,
      m.play ? h('button', { type: 'button', class: 'play', title: 'Play it: click through it at full size', onclick: (e) => { e.stopPropagation(); openPlay(f) } }, '▷', h('span', { class: 'word' }, ' PLAY')) : null,
    )
    f.labelEl.addEventListener('pointerdown', (e) => startFrameDrag(e, f))
    // Its right edge, dragged as a Figma frame's: the screen is shown at the width as it goes, and written on release.
    f.edgeEl = serve && !f.crop ? h('div', { class: 'frame-edge', title: 'Drag to change its width' }) : null
    f.edgeEl?.addEventListener('pointerdown', (e) => startEdgeDrag(e, f))
    drawLock(f)
    positionFrame(f)
    world.append(f.el, f.labelEl, ...(f.edgeEl ? [f.edgeEl] : []))
  }
  function widthMenu(anchor, f) {
    openMenu(anchor, [
      { note: 'Width on the board' },
      ...ARTBOARD_SIZES.map(([n, w]) => ({ label: `${n} · ${w}${f.w === w ? '  ✓' : ''}`, run: () => setFrameWidth(f, w) })),
      { label: 'Custom…', run: async () => {
        const v = Math.round(Number(await question('Width in pixels, 240 to 3840:', String(f.w))))
        if (v >= 240 && v <= 3840) setFrameWidth(f, v)
        else if (v) hint('A width from 240 to 3840', 2000)
      } },
    ])
  }
  /** A prototype's width on the board is its `<meta name="canvas-width">`, written into the file (one edit, so Ctrl+Z
      takes it back); every frame of that file is drawn at the new width and measured again for its height. */
  // A screen seen in its light or dark mode, as a Figma frame is set to a variable mode: its own
  // `prefers-color-scheme` rules are switched on or off for this screen alone, whatever this computer is set to.
  // Only what is seen changes, never the file; kept per screen in this browser.
  const schemeOf = (f) => store.get(`scheme:${f.key}`) || 'auto'
  const schemeText = new WeakMap()
  function applyScheme(f) {
    const doc = f.doc
    if (!doc) return
    const mode = schemeOf(f)
    const walk = (rules) => {
      for (const r of rules) {
        if (r.media && /prefers-color-scheme/.test(r.media.mediaText + (schemeText.get(r) ?? ''))) {
          if (!schemeText.has(r)) schemeText.set(r, r.media.mediaText)
          const was = schemeText.get(r)
          // The feature is swapped for one always true (or never true) at a screen's width, so a query joined to others
          // (\`screen and (prefers-color-scheme: dark)\`) still reads.
          const now = mode === 'auto' ? was : was.replace(/\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/g, (_, k) => (k === mode ? '(min-width: 0px)' : '(min-width: 99999px)'))
          if (r.media.mediaText !== now) r.media.mediaText = now
        }
        if (r.cssRules) try { walk(r.cssRules) } catch {}
      }
    }
    for (const sh of doc.styleSheets) { try { walk(sh.cssRules) } catch {} }
    // Form controls and scroll bars follow the mode too.
    let tag = doc.head?.querySelector('style[data-dc-scheme]')
    if (mode === 'auto') tag?.remove()
    else {
      if (!tag && doc.head) { tag = doc.createElement('style'); tag.setAttribute('data-dc-scheme', ''); doc.head.append(tag) }
      if (tag) tag.textContent = `:root { color-scheme: ${mode} }`
    }
  }
  // Figma's outlines: every element's box drawn as a thin line, in every screen, so what holds what can be seen. Only
  // what is seen changes, never the file; kept in this browser.
  let outlinesOn = !!store.get('outlines')
  function applyOutlines(f) {
    const doc = f.doc
    if (!doc?.head) return
    let tag = doc.head.querySelector('style[data-dc-view="outlines"]')
    if (!outlinesOn) return tag?.remove()
    if (!tag) { tag = doc.createElement('style'); tag.setAttribute('data-dc-view', 'outlines'); doc.head.append(tag) }
    tag.textContent = 'body *{outline:1px solid rgba(37,99,235,.55)!important;outline-offset:-1px!important}'
  }
  function setOutlines(on) {
    outlinesOn = on
    store.set('outlines', on ? 1 : null)
    for (const f of allFrames.values()) applyOutlines(f)
    call('onView')
    hint(on ? 'Outlines shown: every box in every screen' : 'Outlines hidden', 1400)
  }
  function setScheme(f, mode) {
    store.set(`scheme:${f.key}`, mode === 'auto' ? null : mode)
    applyScheme(f)
    // Seen anew, not loaded anew: the selection stays, and what is drawn over the screen and the panel follow.
    call('onView')
    call('onScheme', f)
  }
  async function setFrameWidth(f, w) {
    if (!f.doc || w === f.w) return
    const cvOf = (el) => (el?.hasAttribute('data-cv') ? Number(el.getAttribute('data-cv')) : null)
    const tag = f.doc.head?.querySelector('meta[name="canvas-width"]')
    const edit = tag
      ? w === 1440 ? { op: 'delete', cv: cvOf(tag) } : { op: 'attr', cv: cvOf(tag), name: 'content', value: String(w) }
      : { op: 'insert', cv: cvOf(f.doc.head), where: 'inside', html: `<meta name="canvas-width" content="${w}">` }
    if (edit.cv == null) return hint('This prototype has no <head> to hold its width', 2500)
    try {
      const res = await fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: f.file, edit, name: me || 'someone' }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Changing the width failed (${res.status})`)
      noteFileEdit()
      applyWidth(f.file, w)
      reloadFile(f.file, body.html)
    } catch (err) {
      hint(err.message, 3000)
    }
  }
  /** Every layout entry and frame of a file takes width `w`; heights are measured again when they load. */
  function applyWidth(file, w) {
    const walk = (o) => {
      if (Array.isArray(o)) return o.forEach(walk)
      if (!o || typeof o !== 'object') return
      if (o.file === file && !o.crop) o.w = w
      for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v)
    }
    walk(data.pages)
    walk(data.loose)
    for (const fr of allFrames.values()) if (fr.file === file && !fr.crop) {
      delete heights[fr.key]
      const b = fr.labelEl?.querySelector('.width')
      if (b) b.textContent = String(w)
    }
    relayout()
  }
  function positionFrame(f) {
    if (!f.el) return
    Object.assign(f.el.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.W}px`, height: `${f.H}px` })
    Object.assign(f.labelEl.style, { left: `${f.x}px`, top: `${f.y}px` })
    if (f.edgeEl) Object.assign(f.edgeEl.style, { left: `${f.x + f.W}px`, top: `${f.y}px`, height: `${f.H}px` })
    f.labelEl.style.setProperty('--w', `${f.W}px`)
    if (f.iframe) {
      f.iframe.style.width = `${f.w}px`
      f.iframe.style.height = `${f.h}px`
      f.iframe.style.transform = f.s !== 1 ? `scale(${f.s})` : ''
    }
  }
  const extent = () => {
    const fs = frames()
    const its = board.items.filter((i) => (i.page ?? firstPage()) === pageId && i.kind !== 'guide')
    const bs = boxes.filter((b) => b.page === pageId)
    const xs = [...fs.map((f) => [f.x, f.x + f.W]), ...its.map((i) => [i.x, i.x + (i.w ?? 0)]), ...bs.map((b) => [b.x, b.x + b.w])].flat()
    const ys = [...fs.map((f) => [f.y, f.y + f.H]), ...its.map((i) => [i.y, i.y + (i.h ?? 0)]), ...bs.map((b) => [b.y, b.y + b.h])].flat()
    if (!xs.length) return { x: -500, y: -400, w: 1500, h: 1000 }
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y: y - 300, w: Math.max(...xs) - x, h: Math.max(...ys) - y + 300 }
  }
  const firstPage = () => pages()[0]?.id ?? 'p1'

  // ── view: pan and zoom ──
  const viewport = $('#viewport')
  // The board moves by its view alone: a focus or a selection out of sight would scroll the viewport itself, and
  // everything placed from the view (bars, dots, pins) would then sit that far from what it belongs to.
  viewport.addEventListener('scroll', () => { if (viewport.scrollTop || viewport.scrollLeft) viewport.scrollTo(0, 0) })
  const view = { x: 0, y: 0, z: 0.1 }
  const MIN_Z = 0.02
  const MAX_Z = 4
  const zoomLabel = $('#zoom-level')
  let loadTimer = 0
  let placeFrame = 0
  let lastZ = 0
  // The board moves at once; what floats over it is placed once a frame, however many pointer and
  // wheel events arrive in it; the view is saved and frames load once the move has settled.
  /** A frame's label too narrow on screen for its name (up to 72px of it) and its buttons puts the
      buttons on a line under the name. Widths are measured once per label and kept; this runs on a zoom only. */
  function stackLabels() {
    let any = false
    for (const f of frames()) {
      const l = f.labelEl
      if (!l?.isConnected) continue
      if (!f.actsW) {
        f.actsW = [...l.querySelectorAll('button')].reduce((a, b) => a + b.offsetWidth + 4, 0)
        // The text's own width: the name's box stretches to fill the label. On screen the label is at 1:1.
        const r = document.createRange()
        r.selectNodeContents(l.querySelector('.name') ?? l)
        f.nameW = Math.min(72, Math.ceil(r.getBoundingClientRect().width))
      }
      const stack = !!f.actsW && f.W * view.z < f.actsW + f.nameW
      l.classList.toggle('stack', stack)
      // A screen drawn narrower than a label's least width (phones zoomed out) keeps its label to its own width, so it
      // does not run over the next screen's: its name cut short, Play as ▷ alone, its other buttons left to its menu.
      l.classList.toggle('narrow', f.W * view.z < 120)
      any ||= stack
    }
    document.body.classList.toggle('labels-stacked', any)
    // A section's heading sits clear of the tallest screen label under it, however many rows its buttons took
    // (read after every label is laid out, so the page is laid out once).
    let tallest = 0
    for (const f of frames()) if (f.labelEl?.isConnected) tallest = Math.max(tallest, f.labelEl.offsetHeight)
    document.body.style.setProperty('--label-h', `${tallest}px`)
  }
  function apply() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`
    placePeers()
    sendView()
    // A pan leaves the zoom as it was: the counter-scaled labels, pins and strokes are restyled only on a zoom.
    if (view.z !== lastZ) {
      lastZ = view.z
      world.style.setProperty('--z', view.z)
      world.style.setProperty('--iz', 1 / view.z)
      zoomLabel.textContent = `${Math.round(view.z * 100)}%`
      document.body.classList.toggle('tiny', 1440 * view.z < 150)
      stackLabels()
    }
    if (!placeFrame) {
      placeFrame = requestAnimationFrame(() => {
        placeFrame = 0
        placeThread()
        placeItemBar()
        call('onView')
      })
    }
    clearTimeout(loadTimer)
    loadTimer = setTimeout(() => {
      loadVisible()
      store.set(`view:${pageId}`, view)
    }, 120)
  }
  function zoomAt(z, sx, sy) {
    z = Math.min(MAX_Z, Math.max(MIN_Z, z))
    const wx = (sx - view.x) / view.z
    const wy = (sy - view.y) / view.z
    view.z = z
    view.x = sx - wx * z
    view.y = sy - wy * z
    apply()
  }
  const panelWidth = () => (document.body.classList.contains('panel-open') && viewport.clientWidth > 640 ? 320 : 0)
  function fitTo(box, pad = 60, most = 1) {
    const vw = viewport.clientWidth - panelWidth()
    pad = Math.min(pad, Math.round(vw / 24))
    const top = 48
    const vh = viewport.clientHeight - top - 64
    const z = Math.min(most, MAX_Z, Math.max(MIN_Z, Math.min((vw - pad * 2) / box.w, (vh - pad * 2) / box.h)))
    view.z = z
    view.x = (vw - box.w * z) / 2 - box.x * z
    view.y = top + (vh - box.h * z) / 2 - box.y * z
    apply()
  }
  const fitAll = () => fitTo(extent())
  /** A page seen for the first time: all of it, unless that is too small to read (under 20%) and it has more than
      one section; then its first section with what sits beside it, readable. F or Shift+1 still shows everything. */
  function firstView() {
    const all = extent()
    const fs = frames()
    const first = fs[0]?.section
    const z = Math.min((viewport.clientWidth - panelWidth() - 120) / all.w, (viewport.clientHeight - 232) / all.h)
    const mine = fs.filter((f) => f.section === first)
    if (z >= 0.2 || !first || mine.length === fs.length) return fitAll()
    const x0 = Math.min(...mine.map((f) => f.x))
    const y0 = Math.min(...mine.map((f) => f.y))
    const y1 = Math.max(...mine.map((f) => f.y + f.H))
    let x1 = Math.max(...mine.map((f) => f.x + f.W))
    let left = x0
    // Notes and shapes beside those frames come into view with them.
    for (const i of board.items.filter((it) => (it.page ?? firstPage()) === pageId && it.kind !== 'guide' && it.y < y1 && it.y + (it.h ?? 0) > y0 - 300)) {
      left = Math.min(left, i.x)
      x1 = Math.max(x1, i.x + (i.w ?? 0))
    }
    fitTo({ x: left, y: y0 - 300, w: x1 - left, h: y1 - y0 + 300 })
  }
  /** Go to a frame on the board: its page, then the frame filling the window. */
  function showFrame(f) {
    if (f.page !== pageId) goPage(f.page)
    fitTo({ x: f.x, y: f.y, w: f.W, h: f.H })
  }
  const center = () => ({ x: (viewport.clientWidth - panelWidth()) / 2, y: viewport.clientHeight / 2 })
  /** Figma's Page Down and Page Up: the next or previous screen on the page, in the order Play steps them, fills the
   * window; from the screen selected, else the one nearest the middle of the window, going round at the ends. */
  function stepScreen(d) {
    const list = frames()
    if (!list.length) return
    const file = call('selectedFile')
    const c = center()
    const mid = { x: (c.x - view.x) / view.z, y: (c.y - view.y) / view.z }
    const far = (f) => Math.hypot(f.x + f.W / 2 - mid.x, f.y + f.H / 2 - mid.y)
    const now = list.find((f) => chosen?.frames.size === 1 && chosen.frames.has(f.key)) ?? list.find((f) => file && f.file === file) ?? list.reduce((a, b) => (far(b) < far(a) ? b : a))
    showFrame(list[(list.indexOf(now) + d + list.length) % list.length])
  }

  function loadVisible() {
    const vw = viewport.clientWidth
    const vh = viewport.clientHeight
    for (const f of frames()) {
      if (f.loaded || !f.el) continue
      const sx = f.x * view.z + view.x
      const sy = f.y * view.z + view.y
      const near = sx < vw * 1.5 && sx + f.W * view.z > -vw / 2 && sy < vh * 1.5 && sy + f.H * view.z > -vh / 2
      if (!near) continue
      f.loaded = true
      loadFrame(f)
    }
  }
  function loadFrame(f) {
    // The old document goes with its frame: nothing reads it while the new one loads.
    f.doc = null
    f.iframe?.remove()
    const iframe = h('iframe', { srcdoc: docFor(f), title: f.label, tabindex: '-1' })
    f.iframe = iframe
    positionFrame(f)
    iframe.addEventListener('load', () => {
      f.el?.querySelector('.placeholder')?.remove()
      f.doc = iframe.contentDocument
      // A wheel or a trackpad scroll that lands in the artboard's own page moves the board, as it does over empty board:
      // Safari hands it to the frame under the pointer even though the frame takes no presses.
      const toBoard = (x, y) => {
        const r = iframe.getBoundingClientRect()
        const k = iframe.clientWidth ? r.width / iframe.clientWidth : 1
        return { x: r.left + x * k, y: r.top + y * k }
      }
      if (f.doc) {
        f.doc.addEventListener('wheel', (e) => {
          const at = toBoard(e.clientX, e.clientY)
          boardWheel(e, at.x, at.y)
        }, { passive: false })
        listenForPinch(f.doc, toBoard)
      }
      // The file's own width, changed here, by an undo or by an agent, is the width the frame is drawn at.
      if (serve && !f.crop && f.doc?.head) {
        const own = Number(f.doc.head.querySelector('meta[name="canvas-width"]')?.getAttribute('content')) || 1440
        if (own >= 240 && own <= 3840 && own !== f.w) applyWidth(f.file, own)
      }
      // An edit that makes the page taller or shorter makes the frame follow.
      if (serve && !f.crop && f.doc?.documentElement) {
        const tall = Math.min(MAX_H, Math.max(MIN_H, Math.ceil(f.doc.documentElement.scrollHeight)))
        if (Math.abs(tall - f.h) > 4 && !f.hash) {
          heights[f.key] = tall
          relayout()
        }
      }
      applyScheme(f)
      applyOutlines(f)
      call('onFrameLoad', f)
      renderPins()
    })
    f.el.append(iframe)
  }
  function relayout() {
    layoutAll()
    for (const f of frames()) {
      if (!f.el) drawFrame(f)
      positionFrame(f)
    }
    drawGroups()
    renderItems()
    drawLocks()
    renderPins()
    call('onView')
  }
  /** A file changed: every frame drawing it is redrawn from the new HTML. */
  /** The file drawn again in every frame showing it. Not while someone is typing in one of them: the editor keeps the
   *  new file and draws it when the typing ends (false then). */
  function reloadFile(file, html) {
    if (call('holdFile', file, html)) return false
    data.files[file] = html
    delete fileHtml[file]
    for (const f of allFrames.values()) if (f.file === file && f.loaded && f.el) loadFrame(f)
    if (playing?.file === file) playFrame.srcdoc = docFor(playing)
    return true
  }
  /** A stylesheet the prototypes link, changed: every file that links it redraws. False when nothing changed. */
  function reloadSheet(sheet, text) {
    const known = data.assets[sheet]
    if (known && known.text === text) return false
    if (known) known.text = text
    for (const file of Object.keys(data.files)) {
      const html = data.files[file]
      if (known && html.includes(`__RC_ASSET__(${sheet})`)) reloadFile(file, html)
      // A sheet the page was sent after it loaded is in the file itself: the file is asked for again.
      else if (html.includes(`data-dc-sheet="${sheet}"`)) fileChanged(file, { quiet: true })
    }
    return true
  }

  function boardWheel(e, sx, sy) {
    e.preventDefault()
    // A mouse wheel's notch (lines, or a delta of 50 and up) moves the zoom shown by 2 points below
    // 100%, and by 2% of itself above; a trackpad pinch's small deltas zoom with the fingers.
    // Safari's pinch zooms from its own gesture events below, so the Control-held wheels it also sends are left alone.
    if (e.ctrlKey || e.metaKey) {
      if (trackpadPinch) return
      const notch = e.deltaMode === 1 || Math.abs(e.deltaY) >= 50
      zoomAt(notch ? view.z - Math.sign(e.deltaY) * 0.02 * Math.max(1, view.z) : view.z * Math.exp(-e.deltaY * 0.01), sx, sy)
    }
    else {
      view.x -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX
      view.y -= e.shiftKey && !e.deltaX ? 0 : e.deltaY
      apply()
    }
  }
  viewport.addEventListener('wheel', (e) => boardWheel(e, e.clientX, e.clientY), { passive: false })

  const toWorld = (sx, sy) => ({ x: (sx - view.x) / view.z, y: (sy - view.y) / view.z })
  const toScreen = (wx, wy) => ({ x: wx * view.z + view.x, y: wy * view.z + view.y })
  const frameAt = (sx, sy) => {
    const p = toWorld(sx, sy)
    const fs = frames()
    for (let i = fs.length - 1; i >= 0; i--) {
      const f = fs[i]
      if (p.x >= f.x && p.x <= f.x + f.W && p.y >= f.y && p.y <= f.y + f.H) return f
    }
    return null
  }

  // ── tools ──
  let tool = 'select'
  let shapeKind = store.get('shape') || 'rect'
  let spaceHeld = false
  const DRAW = ['note', 'rect', 'ellipse', 'diamond', 'triangle', 'section', 'line', 'arrow', 'pencil', 'artboard', 'stamp']
  const SHAPES = ['rect', 'ellipse', 'diamond', 'triangle', 'section', 'line', 'arrow', 'guide']
  /** Figma's Shift+C: the comment pins on the board shown or hidden, kept in this browser; the comment tool and the
   * Comments tab show them again. */
  function setPinsShown(on, quiet = false) {
    document.body.classList.toggle('pins-off', !on)
    store.set('pins-off', !on)
    if (!quiet) hint(on ? 'Comments shown' : 'Comments hidden (Shift+C shows them)', 1400)
  }
  function setTool(t) {
    if (t === 'comment' && document.body.classList.contains('pins-off')) setPinsShown(true, true)
    tool = t
    document.body.className = document.body.className.replace(/\btool-\S+/g, '').trim()
    document.body.classList.add(`tool-${t}`)
    for (const b of document.querySelectorAll('#toolbar [data-tool]')) {
      const on = b.dataset.tool === t || (b.id === 'shape-tool' && SHAPES.includes(t))
      b.setAttribute('aria-pressed', String(on))
    }
    if (t !== 'comment' && draft) closeThread()
    if (t !== 'select') pickItem(null)
    sizesBar.hidden = t !== 'artboard'
    stampBar.hidden = t !== 'stamp'
    penBar.hidden = t !== 'pencil'
    if (t === 'pencil') renderPens()
    call('onTool', t)
  }
  // The artboard tool's sizes, as Figma's frame presets: a click on the board makes the one chosen; a drag, any size.
  const ARTBOARD_SIZES = [['Desktop', 1440, 900], ['Laptop', 1280, 800], ['Tablet', 834, 1194], ['Phone', 390, 844]]
  const artboardSize = () => ARTBOARD_SIZES.find(([n]) => n === store.get('artboardSize')) ?? ARTBOARD_SIZES[0]
  const sizesBar = h('div', { id: 'artboard-sizes', hidden: true, role: 'toolbar', 'aria-label': 'Artboard size' })
  function renderSizes() {
    sizesBar.replaceChildren(h('span', { class: 'note' }, 'Click for'), ...ARTBOARD_SIZES.map(([n, w, hh]) => h('button', {
      type: 'button', class: 'tool', 'aria-pressed': String(artboardSize()[0] === n), title: `${w} × ${hh}`,
      onclick: () => { store.set('artboardSize', n); renderSizes() },
    }, n, h('small', {}, ` ${w}`))), h('span', { class: 'note' }, 'or drag any size'))
  }
  renderSizes()
  document.body.append(sizesBar)
  // FigJam's stamps: the one to put down, chosen on a bar over the toolbar while the stamp tool is in hand.
  const STAMPS = [['👍', 'Thumbs up'], ['❤️', 'Love'], ['⭐', 'Star'], ['✅', 'Done'], ['❓', 'Question'], ['🔥', 'Hot'], ['+1', 'Plus one']]
  const stampNow = () => STAMPS.find(([g]) => g === store.get('stamp'))?.[0] ?? STAMPS[0][0]
  const stampBar = h('div', { id: 'stamp-bar', hidden: true, role: 'toolbar', 'aria-label': 'Stamp' })
  function renderStamps() {
    stampBar.replaceChildren(...STAMPS.map(([g, name]) => h('button', { type: 'button', class: 'tool', title: name, 'aria-label': name, 'aria-pressed': String(stampNow() === g), onclick: () => { store.set('stamp', g); renderStamps() } }, g)))
  }
  renderStamps()
  document.body.append(stampBar)
  // FigJam's pens: a fine line, a marker, a bold one or a highlighter (wide and see-through), and their colors,
  // chosen on a bar over the toolbar while the pencil is in hand, kept in this browser.
  const PENS = [['fine', 'Fine', 3, ''], ['marker', 'Marker', 5, ''], ['bold', 'Bold', 10, ''], ['highlight', 'Highlighter', 24, 'highlight']]
  const penNow = () => PENS.find(([k]) => k === store.get('pen')) ?? PENS[1]
  const penColor = () => store.get('penColor') || (penNow()[3] ? '#f59e0b' : SHAPE_COLORS[0])
  const penBar = h('div', { id: 'pen-bar', hidden: true, role: 'toolbar', 'aria-label': 'Pen' })
  function renderPens() {
    penBar.replaceChildren(
      ...PENS.map(([k, name, w]) => h('button', { type: 'button', class: 'tool', title: name, 'aria-label': name, 'aria-pressed': String(penNow()[0] === k), onclick: () => { store.set('pen', k); renderPens() } },
        h('span', { class: 'pen-line', style: `height:${Math.min(14, Math.max(2, w / 2))}px;${k === 'highlight' ? 'opacity:.45;' : ''}background:${penColor()}` }))),
      h('span', { class: 'sep' }),
      ...SHAPE_COLORS.map((c) => h('button', { type: 'button', class: `swatch${penColor() === c ? ' on' : ''}`, style: `background:${c}`, title: COLOR_NAMES[c] ?? c, 'aria-label': COLOR_NAMES[c] ?? c, 'aria-pressed': String(penColor() === c), onclick: () => { store.set('penColor', c); renderPens() } })))
  }
  // Drawn when the pencil is taken up: the colors it lists are set further on.
  document.body.append(penBar)
  /** What a stamp at a point sits on: the topmost note, shape or picture there (a section only where nothing else is). */
  function stampTarget(x, y) {
    const under = items().filter((i) => ['note', 'rect', 'ellipse', 'diamond', 'triangle', 'image', 'section'].includes(i.kind) && x >= i.x && x <= i.x + (i.w ?? 0) && y >= i.y && y <= i.y + (i.h ?? 0))
    return under.filter((i) => i.kind !== 'section').pop() ?? under.pop() ?? null
  }
  /** A stamp's fields for where it now stands: held by what is under its middle, at its place on that. */
  function stampAt(x, y) {
    const on = stampTarget(x + 24, y + 24)
    return on ? { x, y, to: on.id, dx: Math.round(x - on.x), dy: Math.round(y - on.y) } : { x, y, to: '', dx: 0, dy: 0 }
  }
  const SHAPE_NAMES = { rect: 'Rectangle (R)', ellipse: 'Ellipse', diamond: 'Diamond', triangle: 'Triangle', section: 'Section (S)', line: 'Line', arrow: 'Arrow', guide: 'Layout guide' }
  function setShape(kind) {
    shapeKind = kind
    store.set('shape', kind)
    const b = $('#shape-tool')
    b.dataset.tool = kind
    b.title = SHAPE_NAMES[kind]
    b.setAttribute('aria-label', SHAPE_NAMES[kind])
    b.replaceChildren(icon(kind))
    setTool(kind)
  }
  for (const b of document.querySelectorAll('#toolbar [data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool))
  $('#shape-more').addEventListener('click', (e) => openMenu(e.currentTarget, SHAPES.map((k) => ({ label: SHAPE_NAMES[k], icon: k, tick: shapeKind === k, run: () => setShape(k) }))))

  // Pointer on the board: the editor sees it first; then panning, drawing, picking board objects.
  let drag = null
  // A finger is not a mouse: with the select or text tool it drags the board, and a tap (a press
  // that does not move) is replayed as the press it would have been, so it still selects, follows
  // a link or starts a comment. Two fingers pinch to zoom and pan together. A drawing tool draws.
  const touches = new Map()
  let pinch = null
  const TAP_SLOP = 10
  const capture = (id) => {
    try { viewport.setPointerCapture(id) } catch {}
  }
  function startPinch() {
    const [a, b] = [...touches.values()]
    if (drag && drag.kind !== 'pan') drag.cancel?.()
    drag = null
    viewport.classList.remove('panning')
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    pinch = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), z0: view.z, w: toWorld(mid.x, mid.y) }
  }
  function movePinch() {
    const [a, b] = [...touches.values()]
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const z = Math.min(MAX_Z, Math.max(MIN_Z, (pinch.z0 * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d0))
    view.z = z
    view.x = mid.x - pinch.w.x * z
    view.y = mid.y - pinch.w.y * z
    apply()
  }
  viewport.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.size === 2) return startPinch()
      if (touches.size > 2 || pinch) return
      const onPicked = e.target.closest('.item.on')
      if ((tool === 'select' || tool === 'text') && !onPicked && !e.target.closest('button, .pin, .frame-label, [contenteditable]')) {
        closeMenu()
        drag = { kind: 'pan', id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false, forced: false, tap: e }
        capture(e.pointerId)
        return
      }
    }
    pressDown(e)
  })
  function pressDown(e) {
    if (e.button === 1 || e.button === 0) closeMenu()
    if (e.target.closest('button, .pin, .frame-label, [contenteditable]')) return
    const p = toWorld(e.clientX, e.clientY)
    const f = frameAt(e.clientX, e.clientY)
    const itemEl = e.target.closest('.item')
    const panning = e.button === 1 || tool === 'hand' || spaceHeld
    // A link in a board object's words: Ctrl or Cmd + press opens it (a plain press picks the object); where nothing
    // can be edited, a plain press opens it.
    const link = e.button === 0 && e.target.closest?.('a.board-link')
    if (link && (e.ctrlKey || e.metaKey || !serve)) {
      e.preventDefault()
      open(link.href, '_blank', 'noopener')
      return
    }
    if (!panning && e.button === 0) {
      if (call('onPointerDown', e, { frame: f, point: p, tool, item: itemEl?.dataset.id ?? null })) return
      // While voting, a click on a note or shape casts a vote there, and a click on a vote of one's own takes it back.
      if (board.voting && tool === 'select' && serve && castVote(p, itemEl)) return
      // A section is taken by its label or its border; a press anywhere else inside it draws a selection box.
      if (tool === 'select' && itemEl && serve && itemEl.classList.contains('section') && !e.target.closest('.txt')) {
        const s = board.items.find((i) => i.id === itemEl.dataset.id)
        const edge = 24 / view.z
        if (s && p.x > s.x + edge && p.x < s.x + s.w - edge && p.y > s.y + edge && p.y < s.y + s.h - edge) return startMarquee(e, p)
      }
      if (tool === 'select' && itemEl && serve) return startItemDrag(e, itemEl.dataset.id)
      if (DRAW.includes(tool) || (tool === 'guide')) return startDraw(e, p, f)
      if (tool === 'text' && !f) return newTitle(p)
      // While editing, a drag from empty board draws a selection box; Space, the middle button, the hand or the wheel pan.
      if (tool === 'select' && !f && serve) return startMarquee(e, p)
    }
    if (e.button !== 0 && e.button !== 1) return
    drag = { kind: 'pan', id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false, forced: panning }
    capture(e.pointerId)
  }
  // A right-click opens the menu of what is under it, as in Figma: an element in a prototype, a board object (picked
  // first if it is not in the selection, with its group), or the board itself. Text being typed keeps the browser's
  // own menu, for its spelling.
  viewport.addEventListener('contextmenu', (e) => {
    if (e.target.closest('[contenteditable="true"], input, textarea')) return
    e.preventDefault()
    const at = { x: e.clientX, y: e.clientY }
    const itemEl = e.target.closest('.item')
    const f = itemEl ? null : frameAt(e.clientX, e.clientY)
    if (f && call('onContextMenu', e, { frame: f, point: toWorld(e.clientX, e.clientY) })) return
    if (itemEl && serve) {
      const id = itemEl.dataset.id
      if (!selectedItems().some((i) => i.id === id) && !chosen?.items.has(id)) {
        const g = withGroup(id)
        g.length > 1 ? chooseItems(g) : pickItem(id)
      }
      return openMenu(at, itemMenu())
    }
    if (!f) openMenu(at, [
      serve && boardClip ? { label: 'Paste here', run: () => pasteAt(toWorld(at.x, at.y)) } : null,
      serve && boardClip ? { label: 'Paste', key: 'Ctrl+V', run: pasteItems } : null,
      serve && boardClip ? { label: 'Paste in place', key: 'Ctrl+Shift+V', run: pasteInPlace } : null,
      serve && boardClip && selectedItems().length ? { label: 'Paste to replace', key: 'Ctrl+Shift+R', run: pasteReplace } : null,
      serve ? { label: 'Select all', key: 'Ctrl+A', run: () => chooseItems(board.items.filter((i) => (i.page ?? firstPage()) === pageId && i.kind !== 'guide').map((i) => i.id), frames().map((f) => f.key)) } : null,
      { label: 'Zoom to fit', key: 'Shift+1', run: fitAll },
      { label: 'Keyboard shortcuts', key: '?', run: openKeys },
    ].filter(Boolean))
  })
  // ── pictures dropped or pasted onto the board ──
  // Each is saved into the folder's images/ and placed where it was dropped, at its own size (no wider than 1200),
  // side by side when there are several, all in one undo step, and selected.
  let lastPoint = null
  viewport.addEventListener('pointermove', (e) => { lastPoint = { x: e.clientX, y: e.clientY } })
  const PICTURE_TYPES = /^image\/(png|jpeg|gif|webp|avif)$/
  /** Dropped on a prototype, or pasted while one of its elements is selected, the picture goes into that prototype
   *  (the editor's placePicture); anywhere else, onto the board. */
  async function placePictures(files, at, into = null) {
    const pics = [...files].filter((f) => PICTURE_TYPES.test(f.type))
    if (!pics.length) return false
    if (!serve) return hint(readOnly, 4000), true
    if (into) {
      const [s] = await savePictures(pics.slice(0, 1))
      if (s) call('placePicture', s.src, into)
      return true
    }
    const saved = await savePictures(pics)
    if (!saved.length) return true
    const p = toWorld(at.x, at.y)
    let x = Math.round(p.x - saved[0].w / 2)
    const ids = []
    for (const s of saved) {
      const ev = await sendBoard({ op: 'item', kind: 'image', page: pageId, src: s.src, x, y: Math.round(p.y - s.h / 2), w: s.w, h: s.h })
      ids.push(ev.id)
      x += s.w + 24
    }
    renderItems()
    chooseItems(ids)
    hint(saved.length > 1 ? `Placed ${saved.length} pictures` : 'Placed the picture', 1200)
    return true
  }
  /** Each picture saved into the folder's images/, with its size to place it at (no wider than 1200). */
  async function savePictures(pics) {
    const saved = []
    for (const file of pics) {
      try {
        const res = await fetch(`/api/image?name=${encodeURIComponent(file.name || 'image')}`, { method: 'POST', headers: { 'content-type': file.type }, body: file })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || `Saving the picture failed (${res.status})`)
        const size = await new Promise((r) => { const img = new Image(); img.onload = () => r({ w: img.naturalWidth, h: img.naturalHeight }); img.onerror = () => r({ w: 400, h: 300 }); img.src = body.src })
        const k = Math.min(1, 1200 / Math.max(1, size.w))
        saved.push({ src: body.src, w: Math.max(1, Math.round(size.w * k)), h: Math.max(1, Math.round(size.h * k)) })
      } catch (err) {
        hint(err.message, 4000)
      }
    }
    return saved
  }
  viewport.addEventListener('dragover', (e) => {
    if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) e.preventDefault()
  })
  viewport.addEventListener('drop', (e) => {
    const files = e.dataTransfer?.files
    if (!files?.length || ![...files].some((f) => PICTURE_TYPES.test(f.type))) return
    e.preventDefault()
    const f = e.target.closest?.('.item') ? null : frameAt(e.clientX, e.clientY)
    placePictures(files, { x: e.clientX, y: e.clientY }, f?.doc ? { frame: f, point: toWorld(e.clientX, e.clientY) } : null)
  })
  document.addEventListener('paste', (e) => {
    if (e.target.closest?.('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]') || document.body.classList.contains('playing')) return
    const files = e.clipboardData?.files
    const at = lastPoint ?? { x: innerWidth / 2, y: innerHeight / 2 }
    if (files?.length && [...files].some((f) => PICTURE_TYPES.test(f.type))) {
      e.preventDefault()
      return placePictures(files, at, call('selectedFile') ? { selected: true } : null)
    }
    // Words pasted, as FigJam and Figma make text of them: into the prototype element selected, else a sticky note
    // where the pointer is, grown to hold them all.
    const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n').trim()
    if (!text || !serve) return
    e.preventDefault()
    if (call('selectedFile')) return call('placeText', text)
    pasteNote(text, at)
  })
  async function pasteNote(text, at) {
    const p = toWorld(at.x, at.y)
    try {
      const ev = await sendBoard({ op: 'item', kind: 'note', page: pageId, x: Math.round(p.x - 180), y: Math.round(p.y - 130), w: 360, h: 260, text, color: NOTE_COLORS[0] })
      renderItems()
      const el = document.querySelector(`.item[data-id="${ev.id}"]`)
      const over = el ? el.scrollHeight - el.clientHeight : 0
      if (over > 1) await sendBoard({ op: 'item', id: ev.id, h: Math.ceil(260 + over + 8) })
      pickItem(ev.id)
      renderItems()
    } catch (err) {
      hint(err.message, 3000)
    }
  }
  /** Figma's Tab on the canvas: the next object on the page is picked (Shift+Tab the one before), in reading order
   * (by its top, then its left), going round, and brought into view if it is out of it. */
  function tabItem(d) {
    const list = items().filter((i) => i.kind !== 'guide').sort((a, b) => a.y - b.y || a.x - b.x)
    if (!list.length) return
    const at = list.findIndex((i) => i.id === picked)
    const to = list[(at + d + list.length) % list.length]
    pickItem(to.id)
    const g = geometryOf(to)
    const a = toScreen(g.x, g.y)
    const b = toScreen(g.x + (g.w ?? 0), g.y + (g.h ?? 0))
    // Brought to the middle at the zoom it is at, or further out if it would not fit.
    if (a.x < 0 || a.y < 0 || b.x > viewport.clientWidth - panelWidth() || b.y > viewport.clientHeight) fitTo(boxAround([to.id]), 60, view.z)
  }
  /** FigJam's Select matching: every object on the page of the same kind and color as one selected (a note of the
   * same color, an arrow of the same color), locked ones left out. */
  const colorOf = (i) => String(i.color || (i.kind === 'note' ? NOTE_COLORS[0] : '')).toLowerCase()
  function matching() {
    const ids = chosen ? [...chosen.items] : picked ? withGroup(picked) : []
    const like = new Set(ids.map((id) => board.items.find((i) => i.id === id)).filter(Boolean).map((i) => `${i.kind} ${colorOf(i)}`))
    return items().filter((i) => i.kind !== 'guide' && (like.has(`${i.kind} ${colorOf(i)}`) && (!isLocked(i.id) || ids.includes(i.id)))).map((i) => i.id)
  }
  function selectMatching() {
    const ids = matching()
    if (ids.length) chooseItems(ids)
    hint(`${ids.length} selected`, 1200)
  }
  /** The menu of the board objects selected: what their keys and bar do, in one place. */
  function itemMenu() {
    const ids = chosen ? [...chosen.items] : picked ? withGroup(picked) : []
    const free = ids.some((id) => !isLocked(id))
    const many = chosen && chosen.items.size > 1
    const grouped = ids.some((id) => board.items.find((i) => i.id === id)?.group)
    return [
      free ? { label: 'Cut', key: 'Ctrl+X', run: cutItems } : null,
      { label: 'Copy', key: 'Ctrl+C', run: copyItems },
      boardClip ? { label: 'Paste', key: 'Ctrl+V', run: pasteItems } : null,
      boardClip ? { label: 'Paste in place', key: 'Ctrl+Shift+V', run: pasteInPlace } : null,
      { label: 'Duplicate', key: 'Ctrl+D', run: duplicateItems },
      free ? '-' : null,
      free ? { label: 'Bring forward', key: 'Ctrl+]', run: () => restep(true) } : null,
      free ? { label: 'Send backward', key: 'Ctrl+[', run: () => restep(false) } : null,
      free ? { label: 'Bring to front', key: 'Ctrl+Shift+]', run: () => restack(true) } : null,
      free ? { label: 'Send to back', key: 'Ctrl+Shift+[', run: () => restack(false) } : null,
      free && many ? { label: 'Group', key: 'Ctrl+G', run: () => groupChosen(true) } : null,
      free && grouped && chosen ? { label: 'Ungroup', key: 'Ctrl+Shift+G', run: () => groupChosen(false) } : null,
      free ? { label: 'Flip across', key: 'Shift+H', run: () => flipChosen('x') } : null,
      free ? { label: 'Flip up and down', key: 'Shift+V', run: () => flipChosen('y') } : null,
      { label: 'Wrap in a section', key: 'Ctrl+Alt+G', run: sectionAround },
      { label: 'Zoom to selection', key: 'Shift+2', run: zoomToSelection },
      { label: 'Copy link to selection', run: copyItemsLink },
      !local ? { label: 'Copy as PNG', key: 'Ctrl+Shift+C', run: copyBoardPng } : null,
      !local ? { label: 'Export PNG', run: exportBoardPng } : null,
      matching().length > ids.length ? { label: `Select matching (${matching().length})`, key: 'Ctrl+Alt+A', run: selectMatching } : null,
      '-',
      owner() && free ? { label: 'Lock', run: () => setLock(ids, true) } : null,
      owner() && ids.some(isLocked) ? { label: 'Unlock', run: () => setLock(ids.filter(isLocked), false) } : null,
      '-',
      // What the menu was opened for, even if the selection changed while it stayed open.
      free ? { label: 'Delete', key: 'Del', danger: true, run: () => removeChosen(ids.filter((id) => board.items.some((i) => i.id === id))) } : null,
    ].filter(Boolean).reduce((out, m) => (m === '-' && (!out.length || out.at(-1) === '-') ? out : [...out, m]), []).filter((m, i, all) => m !== '-' || i < all.length - 1)
  }
  viewport.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pinch) return touches.size >= 2 ? movePinch() : undefined
    }
    if (!drag) {
      if (!spaceHeld && tool !== 'hand') call('onHover', e, { frame: frameAt(e.clientX, e.clientY), point: toWorld(e.clientX, e.clientY), tool })
      return
    }
    if (drag.id !== e.pointerId) return
    const dx = e.clientX - drag.sx
    const dy = e.clientY - drag.sy
    if (!drag.moved && Math.hypot(dx, dy) < (drag.tap ? TAP_SLOP : 4)) return
    drag.moved = true
    if (drag.kind === 'pan') {
      viewport.classList.add('panning')
      view.x = drag.vx + dx
      view.y = drag.vy + dy
      apply()
    } else drag.move?.(e, dx / view.z, dy / view.z)
  })
  const endDrag = (e) => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.delete(e.pointerId)
      if (pinch) {
        // The pinch ends with its last finger; one finger left behind does not start a pan.
        if (!touches.size) pinch = null
        return
      }
    }
    if (!drag || drag.id !== e.pointerId) return
    const d = drag
    drag = null
    viewport.classList.remove('panning')
    if (d.kind !== 'pan') return d.end?.(e, d.moved)
    if (d.moved || d.forced) return
    if (d.tap && e.type === 'pointerup') return replayTap(d.tap, e)
    if (d.tap) return
    emptyClick(e)
  }
  // A tap: the press it would have been, then its release, so whatever the press began ends at once.
  function replayTap(down, up) {
    pressDown(down)
    const init = { bubbles: true, cancelable: true, pointerId: up.pointerId, pointerType: 'touch', isPrimary: true, button: 0, buttons: 0, clientX: up.clientX, clientY: up.clientY }
    viewport.dispatchEvent(new PointerEvent('pointerup', init))
  }
  // Safari (and every Mac app built on it) reports a trackpad pinch as gesture events carrying the scale since the
  // fingers went down; left alone it would zoom the whole page, chrome and all, so the board zooms from them instead.
  let trackpadPinch = null
  // A frame's own page passes its gestures here with `toBoard`, which takes its points to the board's.
  function listenForPinch(doc, toBoard = (x, y) => ({ x, y })) {
    doc.addEventListener('gesturestart', (e) => {
      e.preventDefault()
      const at = Number.isFinite(e.clientX) && (e.clientX || e.clientY) ? toBoard(e.clientX, e.clientY) : { x: innerWidth / 2, y: innerHeight / 2 }
      trackpadPinch = { z: view.z, ...at }
    })
    doc.addEventListener('gesturechange', (e) => {
      e.preventDefault()
      if (trackpadPinch && Number.isFinite(e.scale) && e.scale > 0) zoomAt(trackpadPinch.z * e.scale, trackpadPinch.x, trackpadPinch.y)
    })
    doc.addEventListener('gestureend', (e) => {
      e.preventDefault()
      trackpadPinch = null
    })
  }
  listenForPinch(document)
  function emptyClick(e) {
    if (tool === 'comment') return startComment(e.clientX, e.clientY)
    pickItem(null)
    closeThread()
    call('onEmptyClick', e, { frame: frameAt(e.clientX, e.clientY), point: toWorld(e.clientX, e.clientY) })
  }
  viewport.addEventListener('pointerup', endDrag)
  viewport.addEventListener('pointercancel', endDrag)
  viewport.addEventListener('dblclick', (e) => {
    if (e.target.closest('button, .pin, .frame-label')) return
    // A press on an object captures the pointer to the board, so the double-click lands on the
    // board itself: the object is the one under the pointer.
    // What is under it may be a line's own path: a level line's box is 0 tall, so its object is found from the path.
    const itemEl = e.target.closest('.item') ?? document.elementsFromPoint(e.clientX, e.clientY).map((el) => el.closest?.('.item:not(.guide)')).find(Boolean)
    if (itemEl && tool === 'select') return editItemText(itemEl.dataset.id)
    call('onDblClick', e, { frame: frameAt(e.clientX, e.clientY), point: toWorld(e.clientX, e.clientY) })
  })
  viewport.addEventListener('pointerleave', () => call('onHover', null, null))

  // A frame is moved by its header; it lands as a `move` line and stays where it was put.
  function startFrameDrag(e, f) {
    if (e.button !== 0 || e.target.closest('button') || !serve) return
    e.stopPropagation()
    // A screen in a group: the press takes the group, its objects and screens, and moves them as one; a click that
    // does not move still picks the screen.
    const gid = board.moved?.[f.key]?.group
    const members = gid ? groupMembers(gid) : []
    if (gid && (members.length || groupFrames(gid).length > 1)) {
      chooseItems(members, groupFrames(gid))
      if (members.length) {
        startItemDrag(e, members[0])
        const end = drag?.end
        if (drag) drag.end = (ev, moved) => (moved ? end?.(ev, moved) : call('onFramePick', f))
        return
      }
    }
    // A group of screens alone moves together.
    const list = (gid ? groupFrames(gid).map((k) => allFrames.get(k)) : [f]).filter(Boolean)
    const starts = new Map(list.map((x) => [x.key, { x: x.x, y: x.y }]))
    drag = {
      kind: 'frame', id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false,
      move: (ev, dx, dy) => {
        if (isLocked(f.key)) return
        ;({ dx, dy } = straight(ev, dx, dy))
        for (const x of list) {
          if (isLocked(x.key)) continue
          x.x = Math.round(starts.get(x.key).x + dx)
          x.y = Math.round(starts.get(x.key).y + dy)
          positionFrame(x)
        }
        renderItems()
        renderPins()
        call('onView')
      },
      end: async (_, moved) => {
        if (!moved) return call('onFramePick', f)
        if (isLocked(f.key)) return hint(LOCKED, 2000)
        try {
          await sendAll(list.filter((x) => !isLocked(x.key)).map((x) => ({ op: 'move', key: x.key, x: x.x, y: x.y, page: pageId })))
        } catch (err) {
          hint(err.message, 3000)
          takeBoardAgain()
        }
      },
    }
    viewport.setPointerCapture(e.pointerId)
  }

  /** A screen's right edge dragged: its prototype laid out at each width on the way (snapping to the preset widths
      within 12 px, Ctrl held to not snap), and the width written once, as the width menu writes it, on release. */
  function startEdgeDrag(e, f) {
    if (e.button !== 0 || !serve || !f.iframe || tool !== 'select') return
    e.stopPropagation()
    if (isLocked(f.key)) return hint(LOCKED, 2000)
    const w0 = f.w
    let w = w0
    const btn = f.labelEl?.querySelector('.width')
    const show = (n) => {
      f.iframe.style.width = `${n}px`
      Object.assign(f.el.style, { width: `${n * f.s}px` })
      f.edgeEl.style.left = `${f.x + n * f.s}px`
      f.labelEl.style.setProperty('--w', `${n * f.s}px`)
      if (btn) btn.textContent = String(n)
    }
    f.edgeEl.classList.add('dragging')
    drag = {
      kind: 'edge', id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false,
      move: (ev, dx) => {
        w = Math.max(240, Math.min(3840, Math.round(w0 + dx / f.s)))
        const near = ev.ctrlKey || ev.metaKey ? null : ARTBOARD_SIZES.find(([, pw]) => Math.abs(pw - w) <= 12)
        if (near) w = near[1]
        show(w)
        hint(`${near ? `${near[0]} · ` : ''}${w}`, 800)
      },
      end: (_, moved) => {
        f.edgeEl.classList.remove('dragging')
        if (!moved || w === w0) return show(w0)
        setFrameWidth(f, w).then(() => { if (f.w !== w) show(f.w) })
      },
    }
    viewport.setPointerCapture(e.pointerId)
  }

  // ── board objects ──
  const NOTE_COLORS = ['#fde68a', '#bfdbfe', '#ddd6fe', '#fbcfe8', '#bbf7d0', '#fed7aa']
  const SHAPE_COLORS = ['#8a8a96', '#3b82f6', '#a855f7', '#ec4899', '#22c55e', '#f59e0b', '#ef4444', '#ffffff']
  const SECTION_COLORS = ['#8a8a96', '#3b82f6', '#a855f7', '#ec4899', '#22c55e', '#f59e0b']
  /** What each swatch is called, for its tooltip and for a screen reader. */
  const COLOR_NAMES = {
    '#fde68a': 'Yellow', '#bfdbfe': 'Blue', '#ddd6fe': 'Lavender', '#fbcfe8': 'Pink', '#bbf7d0': 'Green', '#fed7aa': 'Peach',
    '#8a8a96': 'Gray', '#3b82f6': 'Blue', '#a855f7': 'Purple', '#ec4899': 'Pink', '#22c55e': 'Green', '#f59e0b': 'Amber', '#ef4444': 'Red', '#ffffff': 'White',
  }
  let picked = null
  // What a drag box took in: board objects and frames, and the box itself.
  let chosen = null
  const items = () => board.items.filter((i) => (i.page ?? firstPage()) === pageId)
  // Redrawing removes a note being typed in, whose blur saves it and asks for another redraw:
  // that one waits until this one is done.
  let drawingItems = false
  let itemsAgain = false
  // Whether a comment is pinned to a board object, whose pin then moves whenever the objects are drawn again.
  let itemPins = false
  function renderItems() {
    if (drawingItems) {
      itemsAgain = true
      return
    }
    drawingItems = true
    try {
      // Drawn in stack order: `z` first, then the order they were made.
      const all = items().map((it, n) => [it, n]).sort((a, b) => (a[0].z ?? 0) - (b[0].z ?? 0) || a[1] - b[1]).map(([it]) => it)
      sectionLayer.replaceChildren(...all.filter((i) => i.kind === 'section').map(itemEl).filter(Boolean))
      itemLayer.replaceChildren(...all.filter((i) => i.kind !== 'section').map(itemEl).filter(Boolean))
      drawVoting()
      if (chosen) {
        // Drawn round what is chosen as it is now, so it follows a drag.
        const b = boxAround([...chosen.items], [...chosen.frames])
        const members = [...chosen.items].map((id) => board.items.find((i) => i.id === id))
        const grouped = members.length > 1 && members.every((i) => i?.group && i.group === members[0].group)
        itemLayer.append(h('div', { class: `chosen-box${grouped ? ' grouped' : ''}`, style: `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px` }))
      }
      // FigJam's quick connectors: a dot beyond each side of a picked note or shape; dragged, it draws an arrow held by
      // this one, to what it is let go on, or to a new one like it there. Clicked, it puts a new one like it on that
      // side, joined by an arrow.
      const it = !chosen && serve && picked ? board.items.find((i) => i.id === picked) : null
      if (it && CONNECTS.includes(it.kind) && !isLocked(it.id) && (it.page ?? firstPage()) === pageId) {
        // Each at the middle of a side, set out from it and sized by the stylesheet in screen pixels, whatever the zoom.
        const at = { n: [it.x + it.w / 2, it.y], e: [it.x + it.w, it.y + it.h / 2], s: [it.x + it.w / 2, it.y + it.h], w: [it.x, it.y + it.h / 2] }
        for (const [side, [x, y]] of Object.entries(at)) {
          itemLayer.append(h('span', { class: 'connect', 'data-side': side, title: 'Drag to connect', style: `left:${x}px;top:${y}px`,
            onpointerdown: (e) => { if (e.button !== 0) return; e.stopPropagation(); e.preventDefault(); startDraw(e, { x, y }, null, { kind: 'arrow', from: it.id, side }) } }))
        }
      }
      for (const f of frames()) f.el?.classList.toggle('chosen', !!chosen?.frames.has(f.key))
    } finally {
      drawingItems = false
    }
    if (itemsAgain) {
      itemsAgain = false
      renderItems()
    }
    placeItemBar()
    showEmpty()
    if (itemPins) movePinsOnItems()
  }
  /** A page with nothing on it says, once, in one quiet line, what can be done with it from here. */
  function showEmpty() {
    const el = $('#empty')
    if (!el) return
    // Comments pinned to the page count as something on it: the card would cover them.
    let pins = false
    try { pins = threads.some((t) => anchorOf(t).page === pageId && (showResolved() || !t.resolved)) } catch {}
    const empty = !frames().length && !items().length && !pins
    el.hidden = !empty
    if (!empty) return
    const edit = !serve && document.querySelector('button#canvas-mode:not(:disabled)')
    el.replaceChildren(
      h('b', {}, 'An empty board'),
      serve ? h('span', { class: 'start' },
        h('button', { type: 'button', onclick: () => setTool('artboard') }, h('kbd', {}, 'A'), ' A new prototype screen'),
        h('span', {}, 'or pick a tool below for notes, text, drawings and shapes, or ', h('button', { type: 'button', class: 'link', onclick: (e) => templateMenu(e.currentTarget) }, 'start from a template'), '. ', h('kbd', {}, '?'), ' shows every key.'))
        : edit ? h('span', {}, h('button', { type: 'button', onclick: () => edit.click() }, 'Edit'), ' and pick this folder to draw on it.')
          : h('span', {}, 'Nothing has been put on this page yet.'))
  }
  // ── arrows that hold on: an end bound to an object or a frame is drawn at that one's edge ──
  const BINDS = ['note', 'rect', 'ellipse', 'diamond', 'triangle', 'section']
  const CONNECTS = ['note', 'rect', 'ellipse', 'diamond', 'triangle']
  // A diamond's and a triangle's corners, in hundredths of its box.
  const FORMS = { diamond: [[50, 0], [100, 50], [50, 100], [0, 50]], triangle: [[50, 0], [100, 100], [0, 100]] }
  /** The box a `from` or `to` names on this page: a board object's (with its kind, for its outline), or a frame's. */
  function boxOfRef(ref) {
    if (!ref) return null
    const it = board.items.find((i) => i.id === ref)
    if (it) return BINDS.includes(it.kind) && (it.page ?? firstPage()) === pageId ? { x: it.x, y: it.y, w: it.w ?? 0, h: it.h ?? 0, kind: it.kind } : null
    const f = allFrames.get(ref)
    return f && f.page === pageId ? { x: f.x, y: f.y, w: f.W, h: f.H } : null
  }
  /** Where the line from a box's center towards a point leaves the box. */
  function edgeToward(b, p) {
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    const dx = p.x - cx
    const dy = p.y - cy
    if (!dx && !dy) return { x: cx, y: cy }
    let t = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity)
    // An ellipse is met on its curve; a diamond or triangle on the side the line crosses, as FigJam's connectors meet
    // a shape's outline.
    if (b.kind === 'ellipse' && b.w && b.h) t = 1 / Math.hypot(dx / (b.w / 2), dy / (b.h / 2))
    else if (FORMS[b.kind]) {
      const c = FORMS[b.kind].map(([u, v]) => [b.x + (u / 100) * b.w, b.y + (v / 100) * b.h])
      let best = Infinity
      c.forEach(([x1, y1], i) => {
        const [x2, y2] = c[(i + 1) % c.length]
        const ex = x2 - x1
        const ey = y2 - y1
        const den = dx * ey - dy * ex
        if (!den) return
        const s1 = ((x1 - cx) * ey - (y1 - cy) * ex) / den
        const s2 = ((x1 - cx) * dy - (y1 - cy) * dx) / den
        if (s1 > 0 && s2 >= 0 && s2 <= 1) best = Math.min(best, s1)
      })
      if (best < Infinity) t = best
    }
    return { x: cx + dx * Math.min(1, t), y: cy + dy * Math.min(1, t) }
  }
  /** A line or arrow as it is drawn now: its own points, or, for a bound end, the edge it holds. */
  function geometryOf(it) {
    const pts = it.points ?? []
    if (!['line', 'arrow'].includes(it.kind) || pts.length < 4) return it
    let a = { x: it.x + pts[0], y: it.y + pts[1] }
    let b = { x: it.x + pts[pts.length - 2], y: it.y + pts[pts.length - 1] }
    const A = boxOfRef(it.from)
    const B = boxOfRef(it.to)
    if (!A && !B) return it
    const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
    if (A && B) {
      a = edgeToward(A, center(B))
      b = edgeToward(B, center(A))
    } else if (A) a = edgeToward(A, b)
    else b = edgeToward(B, a)
    const x = Math.round(Math.min(a.x, b.x))
    const y = Math.round(Math.min(a.y, b.y))
    return { ...it, x, y, w: Math.round(Math.abs(a.x - b.x)), h: Math.round(Math.abs(a.y - b.y)), points: [a.x - x, a.y - y, b.x - x, b.y - y].map(Math.round) }
  }
  /** What a line drawn from or to this point holds on to: the smallest note or shape under it, else
   * a frame, else the smallest section — a section lies under everything it holds. */
  function bindAt(p) {
    const under = items().filter((i) => BINDS.includes(i.kind) && p.x >= i.x && p.x <= i.x + i.w && p.y >= i.y && p.y <= i.y + i.h)
    under.sort((a, b) => a.w * a.h - b.w * b.h)
    const shape = under.find((i) => i.kind !== 'section')
    if (shape) return shape.id
    const f = frames().findLast((f) => p.x >= f.x && p.x <= f.x + f.W && p.y >= f.y && p.y <= f.y + f.H)
    if (f) return f.key
    return under[0]?.id ?? null
  }

  // A color is a hex, a name or rgb()/hsl() numbers, nothing else: a color from a canvas file
  // goes into a style, and a style may not fetch (url()) or break out of its declaration.
  const safeColor = (c) => (typeof c === 'string' && /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(?:rgb|hsl)a?\([\d.,%\s/]+\))$/i.test(c.trim()) ? c.trim() : '')
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  /** An SVG path through x, y pairs: straight to the first midpoint, a quadratic curve to each next midpoint with the sample between as its control, straight to the end. */
  function smooth(pts) {
    const r = (n) => Math.round(n * 10) / 10
    let d = `M${pts[0]},${pts[1]} L${r((pts[0] + pts[2]) / 2)},${r((pts[1] + pts[3]) / 2)}`
    for (let i = 2; i < pts.length - 2; i += 2) d += ` Q${pts[i]},${pts[i + 1]} ${r((pts[i] + pts[i + 2]) / 2)},${r((pts[i + 1] + pts[i + 3]) / 2)}`
    return `${d} L${pts[pts.length - 2]},${pts[pts.length - 1]}`
  }
  function itemEl(it) {
    it = geometryOf(it)
    it = { ...it, color: safeColor(it.color), x: num(it.x), y: num(it.y), w: num(it.w), h: num(it.h) }
    const cls = `item ${it.kind}${picked === it.id || chosen?.items.has(it.id) ? ' on' : ''}${isLocked(it.id) ? ' locked' : ''}`
    const box = `left:${it.x}px;top:${it.y}px;width:${it.w ?? 0}px;height:${it.h ?? 0}px`
    // The one object picked shows where it resizes from: its bottom-right corner.
    const grip = serve && picked === it.id && !chosen && !isLocked(it.id) && ['note', 'rect', 'ellipse', 'diamond', 'triangle', 'section', 'image'].includes(it.kind) ? h('span', { class: 'grip', 'aria-hidden': 'true' }) : null
    // A picture from the canvas's folder, by its path there (the server serves it; a canvas.html beside it finds it).
    if (it.kind === 'image') return h('div', { class: cls, 'data-id': it.id, style: box }, /^(?:[\w-]+\/)*[\w-][\w.-]*\.(?:png|jpe?g|gif|webp|avif|svg)$/i.test(String(it.src ?? '')) ? h('img', { src: (data.pictures && /^data:image\//.test(data.pictures[it.src] ?? '') ? data.pictures[it.src] : null) ?? it.src, alt: '', draggable: 'false' }) : null, grip)
    if (it.kind === 'note') {
      const by = it.author === 'show' && it.by ? h('span', { class: 'by', contenteditable: 'false' }, it.by) : null
      return h('div', { class: `${cls}${by ? ' with-by' : ''}`, 'data-id': it.id, style: `${box};background:${it.color || NOTE_COLORS[0]}` }, ...linked(it.text), by, grip)
    }
    if (it.kind === 'title') return h('div', { class: cls, 'data-id': it.id, style: `left:${it.x}px;top:${it.y}px;${it.color ? `color:${it.color};` : ''}${it.size ? `font-size:${num(it.size)}px` : ''}` }, it.text || 'Title')
    if (it.kind === 'rect' || it.kind === 'ellipse') return h('div', { class: `${cls}${it.fill === 'solid' ? ' filled' : ''}`, 'data-id': it.id, style: `${box};--c:${it.color || SHAPE_COLORS[0]}` }, h('span', { class: 'txt' }, ...linked(it.text)), grip)
    // A vote, as FigJam's: a dot; while its session goes on, only the one who cast it sees it.
    if (it.kind === 'stamp' && it.vote) {
      if (board.voting?.id === it.vote && it.by !== (me || '')) return null
      return h('div', { class: `${cls} vote`, 'data-id': it.id, style: box, title: `Vote from ${it.by || 'someone'}`, 'aria-label': `Vote from ${it.by || 'someone'}` })
    }
    if (it.kind === 'stamp') return h('div', { class: cls, 'data-id': it.id, style: box, title: `${it.text ?? ''} from ${it.name || 'someone'}`, 'aria-label': `${STAMPS.find(([g]) => g === it.text)?.[1] ?? 'Stamp'} from ${it.name || 'someone'}` }, it.text === '+1' ? h('b', { style: 'font-size:20px' }, '+1') : it.text ?? '')
    if (FORMS[it.kind]) {
      const form = s('svg', { class: 'form', viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' })
      form.append(s('polygon', { points: FORMS[it.kind].map((q) => q.join(',')).join(' ') }))
      return h('div', { class: `${cls}${it.fill === 'solid' ? ' filled' : ''}`, 'data-id': it.id, style: `${box};--c:${it.color || SHAPE_COLORS[0]}` }, form, h('span', { class: 'txt' }, ...linked(it.text)), grip)
    }
    if (it.kind === 'section') return h('div', { class: cls, 'data-id': it.id, style: `${box};--c:${it.color || SECTION_COLORS[0]}` }, h('span', { class: 'txt' }, it.text ?? ''), grip)
    if (it.kind === 'guide') {
      const f = findFrame(it.frame)
      if (!f || f.page !== pageId) return null
      const cols = Math.min(48, Math.max(1, Math.round(num(it.cols)) || 12))
      const m = num((it.margin === '' ? 80 : it.margin ?? 80)) * f.s
      const g = num((it.gutter === '' ? 24 : it.gutter ?? 24)) * f.s
      return h('div', { class: `item guide`, 'data-id': it.id, style: `left:${f.x + m}px;top:${f.y}px;width:${f.W - m * 2}px;height:${f.H}px;grid-template-columns:repeat(${cols},1fr);column-gap:${g}px` }, ...Array.from({ length: cols }, () => h('span'))
      )
    }
    if (['line', 'arrow', 'pencil'].includes(it.kind)) {
      // Built as elements, never as markup: a canvas file's lines are anyone's, so nothing in one is parsed as HTML.
      const pts = (Array.isArray(it.points) ? it.points : []).map(Number).filter(Number.isFinite)
      const straight = pts.reduce((s, v, i) => s + (i % 2 ? `,${v}` : `${i ? ' L' : 'M'}${v}`), '')
      // A pencil stroke is drawn through the midpoints between its samples, each sample the control
      // of a curve, so a hand-drawn line comes out smooth instead of a chain of short straight pieces.
      const d = it.kind === 'pencil' && pts.length >= 6 ? smooth(pts) : (it.kind !== 'pencil' && routed(pts, it.route)) || straight
      const color = it.color || SHAPE_COLORS[0]
      const W = Math.max(1, Number(it.w) || 0)
      const H = Math.max(1, Number(it.h) || 0)
      const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` })
      const markerId = `ah-${String(it.id).replace(/[^\w-]/g, '')}`
      if (it.kind === 'arrow') {
        const marker = s('marker', { id: markerId, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' })
        marker.append(s('path', { d: 'M0 0L10 5L0 10z', fill: color }))
        svg.append(s('defs', {}, marker))
      }
      svg.append(
        s('path', { class: 'ink', d, fill: 'none', stroke: color, 'stroke-width': Number(it.weight) || (it.kind === 'pencil' ? 5 : 4), ...(it.pen === 'highlight' ? { 'stroke-opacity': 0.4 } : {}), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'marker-end': it.kind === 'arrow' ? `url(#${markerId})` : null, 'marker-start': it.kind === 'arrow' && it.ends === 'both' ? `url(#${markerId})` : null, 'stroke-dasharray': it.dash === 'dash' && it.kind !== 'pencil' ? `${(Number(it.weight) || 4) * 3} ${(Number(it.weight) || 4) * 2.5}` : null }),
        s('path', { class: 'hit', d, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(24, Number(it.weight) || 0) }),
      )
      // A line or arrow's label, as Figma's connector text: on its middle, over a backing so it reads across the line.
      const label = it.kind !== 'pencil' && pts.length >= 4 && it.text
        ? h('div', { class: 'txt line-label', style: `left:${(pts[0] + pts[pts.length - 2]) / 2}px;top:${(pts[1] + pts[pts.length - 1]) / 2}px` }, it.text)
        : null
      return h('div', { class: `${cls} svg`, 'data-id': it.id, style: box }, svg, label)
    }
    return null
  }
  // A line's way between its two ends, as FigJam's connectors: an elbow goes across, then up or down, then across
  // (down, across, down where the ends are further apart that way); a curve leaves and arrives the same ways. Both
  // pass through the middle of the two ends, where a label sits.
  function routed(pts, route) {
    if (pts.length !== 4 || !route) return null
    const [x1, y1, x2, y2] = pts
    const mx = (x1 + x2) / 2
    const my = (y1 + y2) / 2
    const across = Math.abs(x2 - x1) >= Math.abs(y2 - y1)
    if (route === 'elbow') return across ? `M${x1},${y1} H${mx} V${y2} H${x2}` : `M${x1},${y1} V${my} H${x2} V${y2}`
    if (route === 'curve') return across ? `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}` : `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`
    return null
  }
  // A board object's own bar: its colors and delete, above it while it is picked.
  const itemBar = h('div', { id: 'itembar', role: 'toolbar', 'aria-label': 'Board object' })
  document.body.append(itemBar)
  function pickItem(id) {
    if (id && !serve) return
    if (picked === id && !chosen) return
    picked = id
    chosen = null
    renderItems()
    if (id) call('onItemPick', id)
  }
  /** Everything wholly inside a box on this page. */
  function inside(b) {
    const within = (x, y, w, hh) => x >= b.x && y >= b.y && x + w <= b.x + b.w && y + hh <= b.y + b.h
    return {
      items: items().map(geometryOf).filter((i) => i.kind !== 'guide' && within(i.x, i.y, i.w ?? 0, i.h ?? 0)).map((i) => i.id),
      frames: frames().filter((f) => within(f.x, f.y, f.W, f.H)).map((f) => f.key),
    }
  }
  function choose(box, got = inside(box)) {
    picked = null
    chosen = got.items.length || got.frames.length ? { box, items: new Set(got.items), frames: new Set(got.frames) } : null
    call('onMarquee')
    renderItems()
    // The agent reads it at GET /api/selection.
    if (serve) fetch('/api/selection', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selection: chosen ? { board: { page: pageId, box, items: [...chosen.items], frames: [...chosen.frames] } } : null }) }).catch(() => {})
  }
  // ── groups: board objects that share a group id are picked, moved, colored and deleted as one ──
  const groupMembers = (gid) => (gid ? items().filter((i) => i.group === gid).map((i) => i.id) : [])
  /** The screens on this page in a group. */
  const groupFrames = (gid) => (gid ? frames().filter((f) => board.moved?.[f.key]?.group === gid).map((f) => f.key) : [])
  /** An object and everything grouped with it. */
  const withGroup = (id) => {
    const g = groupMembers(board.items.find((i) => i.id === id)?.group)
    return g.length > 1 ? g : [id]
  }
  /** The box round some board objects and frames. */
  function boxAround(ids, keys = []) {
    const rs = [
      ...ids.map((id) => board.items.find((i) => i.id === id)).filter(Boolean).map(geometryOf).map((i) => ({ x: i.x, y: i.y, w: i.w ?? 0, h: i.h ?? 0 })),
      ...keys.map((k) => allFrames.get(k)).filter(Boolean).map((f) => ({ x: f.x, y: f.y, w: f.W, h: f.H })),
    ]
    if (!rs.length) return { x: 0, y: 0, w: 0, h: 0 }
    const x = Math.min(...rs.map((r) => r.x))
    const y = Math.min(...rs.map((r) => r.y))
    return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y }
  }
  /** Board objects and frames chosen as one selection, without a drag box. */
  function chooseItems(ids, keys = []) {
    if (!ids.length && !keys.length) return pickItem(null)
    if (ids.length === 1 && !keys.length) return pickItem(ids[0])
    choose(boxAround(ids, keys), { items: ids, frames: keys })
  }
  /** Shift-click: an object, with its group, joins the selection, or leaves it if it is already in. */
  function toggleChosen(id) {
    const have = new Set(chosen ? chosen.items : picked ? withGroup(picked) : [])
    const keys = chosen ? [...chosen.frames] : []
    const add = withGroup(id)
    const all = add.every((x) => have.has(x))
    for (const x of add) all ? have.delete(x) : have.add(x)
    chooseItems([...have], keys)
  }
  const newGroupId = () => 'g-' + Math.random().toString(36).slice(2, 12).padEnd(10, '0')
  /** Ctrl+G: every board object selected becomes one group; Ctrl+Shift+G breaks the groups up. */
  async function groupChosen(on) {
    const ids = [...(chosen?.items ?? [])].filter((id) => !isLocked(id))
    // Screens group with board objects and with each other, as Figma groups frames with stickies.
    const keys = [...(chosen?.frames ?? [])].filter((k) => !isLocked(k))
    if (on && ids.length + keys.length < 2) return hint('Select two or more things on the board to group them', 2000)
    const gid = on ? newGroupId() : ''
    const change = ids.filter((id) => on || board.items.find((i) => i.id === id)?.group)
    const changeFrames = keys.filter((k) => on || board.moved?.[k]?.group)
    if (!change.length && !changeFrames.length) return hint('Nothing selected is in a group', 1600)
    // Objects and screens join the group at once, and stay in it while their lines are saved one by one, so a drag
    // made before the last is saved takes the whole group.
    for (const id of change) ahead.set(`item:${id}`, { group: gid })
    for (const k of changeFrames) ahead.set(`frame:${k}`, { group: gid })
    drawAhead()
    renderItems()
    try {
      for (const id of change) await sendBoard({ op: 'item', id, group: gid })
      for (const k of changeFrames) {
        const f = allFrames.get(k)
        await sendBoard({ op: 'move', key: k, x: f.x, y: f.y, page: pageId, group: gid })
      }
      const n = change.length + changeFrames.length
      hint(on ? `Grouped ${n}: they now move as one` : 'Ungrouped', 1600)
    } catch (err) {
      hint(err.message, 3000)
      takeBoardAgain()
    }
  }
  // ── duplicate, copy and paste ──
  let boardClip = null // { items, times }
  /** What is selected on the board: a drag box's or Shift's objects, or the one picked with its group. */
  const selectedItems = () => (chosen ? [...chosen.items] : picked ? withGroup(picked) : []).map((id) => board.items.find((i) => i.id === id)).filter((i) => i && i.kind !== 'guide')
  // Everything an object is, but where it is bound and which group it is in, which a copy is given anew; a guide's frame stays its own.
  const COPIED = ['kind', 'x', 'y', 'w', 'h', 'text', 'color', 'points', 'from', 'to', 'group', 'size', 'z', 'cols', 'gutter', 'margin', 'frame', 'src', 'route', 'dx', 'dy', 'weight', 'pen', 'ends', 'dash', 'fill', 'author']
  /** New objects like these, moved by dx, dy: a group copied is a new group, and a line holding an
   * object copied with it holds the copy; one holding something left behind lets go where it is. */
  async function placeCopies(list, dx, dy) {
    if (!serve) return hint(readOnly, 2000)
    const ids = new Map()
    const groups = new Map()
    const made = []
    const lines = list.filter((i) => ['line', 'arrow'].includes(i.kind) && (i.from || i.to))
    try {
      for (const src of [...list.filter((i) => !lines.includes(i)), ...lines]) {
        let it = Object.fromEntries(COPIED.filter((k) => src[k] != null).map((k) => [k, src[k]]))
        if (lines.includes(src)) {
          const keep = ['from', 'to'].every((k) => !it[k] || ids.has(it[k]))
          if (keep) for (const k of ['from', 'to']) it[k] = it[k] ? ids.get(it[k]) : it[k]
          else it = { ...it, ...Object.fromEntries(['x', 'y', 'w', 'h', 'points'].map((k) => [k, geometryOf(src)[k]])), from: '', to: '' }
        }
        if (it.group) {
          if (!groups.has(it.group)) groups.set(it.group, newGroupId())
          it.group = groups.get(it.group)
        }
        const id = await addItem({ ...it, x: Math.round(it.x + dx), y: Math.round(it.y + dy) })
        if (!id) break
        ids.set(src.id, id)
        made.push(id)
      }
    } finally {
      renderItems()
    }
    if (made.length) chooseItems(made)
    made.pairs = [...ids]
    return made
  }
  // Figma's duplicate in steps: Ctrl+D puts copies 24 down and right; with those copies still what is selected (moved
  // or not), Ctrl+D again puts the next ones as far again from them as they are from their originals, so a row or a
  // stair of copies is a key press each.
  let lastCopies = null
  const duplicateItems = async () => {
    const list = selectedItems()
    if (!list.length) return
    let dx = 24
    let dy = 24
    const now = new Set(list.map((i) => i.id))
    if (lastCopies && lastCopies.length === now.size && lastCopies.every(([, copy]) => now.has(copy))) {
      const [from, copy] = lastCopies[0]
      const a = board.items.find((i) => i.id === from)
      const b = board.items.find((i) => i.id === copy)
      if (a && b && (b.x !== a.x || b.y !== a.y)) {
        dx = b.x - a.x
        dy = b.y - a.y
      }
    }
    const made = await placeCopies(list, dx, dy)
    lastCopies = made?.pairs?.length ? made.pairs : null
  }
  /** Ctrl+D on screens: each prototype file copied whole to <name>-copy.html, placed to the right of its original,
   *  past any screen in the way, as Figma duplicates a frame. */
  // A canvas held in memory (served read only) writes no files, so a new screen is said to need the folder before
  // anything is asked or sent.
  const NO_FILES = 'This canvas is held in memory, so it cannot make new screens. Serve it from its folder to add them.'
  async function duplicateScreens(list) {
    list = list.filter((f) => f && !f.crop && !f.key.includes('#'))
    if (!list.length) return
    if (data.memory) return hint(NO_FILES, 4000)
    const taken = frames().map((f) => ({ x: f.x, y: f.y, w: f.W, h: f.H }))
    const copies = list.map((f) => {
      const spot = { x: f.x + f.W + 80, y: f.y, w: f.W, h: f.H }
      for (let hit = taken.find((t) => overlaps(t, spot)); hit; hit = taken.find((t) => overlaps(t, spot))) spot.x = hit.x + hit.w + 80
      taken.push(spot)
      return { from: f.file, x: spot.x, y: spot.y, w: f.W, h: f.H }
    })
    try {
      const res = await fetch('/api/artboard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ copies, page: pageId, by: me || 'someone' }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Duplicating failed (${res.status})`)
      // Served by node, the server rebuilds and every page reloads; from disk, the frames are added here.
      if (body.events?.length) {
        boardEvents.push(...body.events)
        board = foldPlaced(boardEvents)
        layoutAll()
        renderPage()
        loadVisible()
      }
      hint(`${body.files.join(', ')} made`, 2000)
    } catch (err) {
      hint(err.message, 4000)
    }
  }
  function copyItems() {
    const list = selectedItems()
    if (!list.length) return false
    boardClip = { items: list.map((i) => ({ ...i })), times: 0 }
    hint(`Copied ${list.length === 1 ? 'it' : list.length}`, 900)
    return true
  }
  /** Ctrl+X, as Figma's Cut: copied, then deleted; the first paste puts them back where they were. */
  function cutItems() {
    const list = selectedItems().filter((i) => !isLocked(i.id))
    if (!list.length) return false
    boardClip = { items: list.map((i) => ({ ...i })), times: -1 }
    hint(`Cut ${list.length === 1 ? 'it' : list.length}`, 900)
    if (chosen) removeChosen()
    else removeItem(picked)
    return true
  }
  // What was copied, as one box on the board.
  const clipBox = () => {
    const gs = boardClip.items.map((i) => geometryOf(i))
    const x = Math.min(...gs.map((g) => g.x))
    const y = Math.min(...gs.map((g) => g.y))
    return { x, y, w: Math.max(...gs.map((g) => g.x + (g.w ?? 0))) - x, h: Math.max(...gs.map((g) => g.y + (g.h ?? 0))) - y }
  }
  /** Ctrl+V: 24 down and right of the originals, then of the last copies; as in Figma, where that is out of sight
   *  (the originals scrolled away, or on another page), in the middle of the view instead. */
  function pasteItems() {
    if (!boardClip) return false
    boardClip.times++
    const b = clipBox()
    const d = 24 * boardClip.times
    const r = viewport.getBoundingClientRect()
    const a = toWorld(r.left, r.top)
    const z = toWorld(r.right, r.bottom)
    const seen = b.x + d < z.x && b.x + d + b.w > a.x && b.y + d < z.y && b.y + d + b.h > a.y
    const samePage = boardClip.items.every((i) => (i.page ?? firstPage()) === pageId)
    if (seen && samePage) placeCopies(boardClip.items, d, d)
    else pasteAt({ x: (a.x + z.x) / 2, y: (a.y + z.y) / 2 }, true)
    return true
  }
  /** Figma's Paste here: what was copied with its top left at a point on the board, or its middle there. */
  function pasteAt(p, middle = false) {
    if (!boardClip) return false
    const b = clipBox()
    placeCopies(boardClip.items, Math.round(p.x - b.x - (middle ? b.w / 2 : 0)), Math.round(p.y - b.y - (middle ? b.h / 2 : 0)))
    return true
  }
  /** Figma's Paste in place (Ctrl+Shift+V): the copies exactly where the originals were, on this page. */
  function pasteInPlace() {
    if (!boardClip) return false
    placeCopies(boardClip.items, 0, 0)
    return true
  }
  /** Figma's Paste to replace (Ctrl+Shift+R): what was copied takes the place of what is selected, centered on it, and
   *  the selected objects go, in one undo step. */
  async function pasteReplace() {
    const list = selectedItems().filter((i) => !isLocked(i.id))
    if (!boardClip || !list.length) return false
    const box = (all) => {
      const gs = all.map((i) => geometryOf(i))
      const x = Math.min(...gs.map((g) => g.x))
      const y = Math.min(...gs.map((g) => g.y))
      return { cx: (x + Math.max(...gs.map((g) => g.x + (g.w ?? 0)))) / 2, cy: (y + Math.max(...gs.map((g) => g.y + (g.h ?? 0)))) / 2 }
    }
    const to = box(list)
    const from = box(boardClip.items)
    picked = null
    chosen = null
    try {
      await sendAll(list.map((i) => ({ op: 'remove', id: i.id })))
    } catch (err) {
      hint(err.message, 3000)
      return true
    }
    await placeCopies(boardClip.items, to.cx - from.cx, to.cy - from.cy)
    return true
  }
  /** For the server's browser making a picture of part of the board: that part at 100% from the window's top left,
      with nothing of the canvas's own over it. */
  function shootBoard(box) {
    picked = null
    chosen = null
    document.body.classList.add('shooting')
    view.z = 1
    view.x = -box.x
    view.y = -box.y
    apply()
    renderItems()
  }
  /** FigJam's Copy as PNG and Export for board objects: the selection with 24 px round it, made by the server's
      browser from this canvas at twice its size. The clipboard is asked at once, with the picture to come. */
  function boardPng() {
    const ids = chosen ? [...chosen.items] : picked ? withGroup(picked) : []
    const keys = chosen ? [...chosen.frames] : []
    if (!ids.length && !keys.length) return null
    if (!serve || local) { hint('To make a picture, run the canvas from its folder with node scripts/canvas.mjs serve <folder>', 5000); return null }
    const b = boxAround(ids, keys)
    const q = new URLSearchParams({ page: pageId, x: String(Math.floor(b.x - 24)), y: String(Math.floor(b.y - 24)), w: String(Math.ceil(b.w + 48)), h: String(Math.ceil(b.h + 48)) })
    hint('Making the picture…', 8000)
    return fetch(`/api/board-png?${q}`).then(async (res) => {
      if (!res.ok) { hint((await res.json().catch(() => ({}))).error || 'No picture was made', 5000); return null }
      return res.blob()
    })
  }
  const NO_PICTURES = "This browser won't copy pictures. Use Export PNG in the right-click menu instead."
  function copyBoardPng() {
    const made = boardPng()
    if (!made) return
    try {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': made.then((b) => b ?? Promise.reject(new Error('no picture'))) })])
        .then(() => hint('Copied as PNG', 1200), () => made.then((b) => b && hint(NO_PICTURES, 5000)))
    } catch {
      hint(NO_PICTURES, 5000)
    }
  }
  async function exportBoardPng() {
    const made = boardPng()
    const blob = made && (await made)
    if (!blob) return
    const first = board.items.find((i) => i.id === (chosen ? [...chosen.items][0] : picked))
    const name = (String(first?.text ?? '').trim().split('\n')[0].replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'board') + '.png'
    save(name, blob, 'image/png')
    hint(`Saved ${name}`, 1600)
  }
  /** Shift+2: the board objects or the prototype elements selected fill the window, never past 400%. */
  function zoomToSelection() {
    const ids = chosen ? [...chosen.items] : picked ? withGroup(picked) : []
    const b = ids.length || chosen?.frames.size ? boxAround(ids, chosen ? [...chosen.frames] : []) : call('selectionBox')
    if (!b) return hint('Select something to zoom to it', 1400)
    fitTo(b, 60, 4)
  }
  // ── front and back: a board object's place in the stack is its `z`, objects without one in the order drawn ──
  async function restack(front) {
    const ids = chosen ? [...chosen.items] : picked ? withGroup(picked) : []
    const list = ids.map((id) => board.items.find((i) => i.id === id)).filter((i) => i && !isLocked(i.id) && i.kind !== 'section' && i.kind !== 'guide')
    if (!list.length) return
    const order = (i) => [i.z ?? 0, board.items.indexOf(i)]
    list.sort((a, b) => order(a)[0] - order(b)[0] || order(a)[1] - order(b)[1])
    const zs = items().map((i) => i.z ?? 0)
    let at = front ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - list.length
    for (const it of list) it.z = at++
    renderItems()
    try {
      await sendAll(list.map((it) => ({ op: 'item', id: it.id, z: it.z })))
    } catch (err) {
      hint(err.message, 3000)
      takeBoardAgain()
    }
  }
  /** Figma's Bring forward and Send backward: each object chosen goes one place up or down the stack, past the next
   * object that overlaps it (one that does not would show no change). The moved ones take a `z` between their new
   * neighbors; when there is no room, every object on the page is numbered again ten apart, in one undo step. */
  async function restep(forward) {
    const ids = chosen ? [...chosen.items] : picked ? withGroup(picked) : []
    const moving = new Set(ids.map((id) => board.items.find((i) => i.id === id)).filter((i) => i && !isLocked(i.id) && i.kind !== 'section' && i.kind !== 'guide'))
    if (!moving.size) return
    const idx = (i) => board.items.indexOf(i)
    const stack = items().filter((i) => i.kind !== 'section').sort((a, b) => (a.z ?? 0) - (b.z ?? 0) || idx(a) - idx(b))
    const box = (i) => { const g = geometryOf(i); return { x: g.x, y: g.y, w: g.w ?? 0, h: g.h ?? 0 } }
    const meets = (a, b) => { const p = box(a), q = box(b); return p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h }
    const moved = []
    for (const it of forward ? [...stack].reverse() : [...stack]) {
      if (!moving.has(it)) continue
      const at = stack.indexOf(it)
      const others = (forward ? stack.slice(at + 1) : stack.slice(0, at).reverse()).filter((o) => !moving.has(o) && o.kind !== 'guide')
      const past = others.find((o) => meets(it, o)) ?? others[0]
      if (!past) continue
      stack.splice(at, 1)
      stack.splice(stack.indexOf(past) + (forward ? 1 : 0), 0, it)
      moved.push(it)
    }
    if (!moved.length) return
    const was = new Map(stack.map((i) => [i, i.z ?? 0]))
    const below = (a, b) => (a.z ?? 0) - (b.z ?? 0) || idx(a) - idx(b)
    let fits = true
    for (const it of moved) {
      const n = stack.indexOf(it)
      const lo = stack[n - 1]
      const hi = stack[n + 1]
      it.z = lo ? (lo.z ?? 0) + 1 : (hi?.z ?? 0) - 1
    }
    for (let n = 1; n < stack.length; n++) if (below(stack[n - 1], stack[n]) >= 0) fits = false
    if (!fits) stack.forEach((i, n) => (i.z = n * 10))
    const sends = stack.filter((i) => (i.z ?? 0) !== was.get(i) || moved.includes(i)).map((i) => ({ op: 'item', id: i.id, z: i.z }))
    renderItems()
    try {
      await sendAll(sends)
    } catch (err) {
      hint(err.message, 3000)
      takeBoardAgain()
    }
  }
  // ── align and distribute: a group in the selection moves as one ──
  function selectedUnits() {
    const ids = [...(chosen?.items ?? [])].filter((id) => {
      const it = board.items.find((i) => i.id === id)
      // A line that holds on to something follows it, so it is not moved on its own.
      return it && it.kind !== 'guide' && !(['line', 'arrow'].includes(it.kind) && (it.from || it.to))
    })
    const units = new Map()
    for (const id of ids) {
      const g = board.items.find((i) => i.id === id).group
      const key = g && groupMembers(g).every((m) => chosen.items.has(m)) ? g : id
      units.set(key, [...(units.get(key) ?? []), id])
    }
    return [...units.values()].map((members) => ({ members, box: boxAround(members) }))
  }
  async function moveUnits(moves) {
    const sends = []
    for (const { members, dx, dy } of moves) {
      if (!dx && !dy) continue
      for (const id of members) {
        if (isLocked(id)) continue
        const it = board.items.find((i) => i.id === id)
        it.x = Math.round(it.x + dx)
        it.y = Math.round(it.y + dy)
        sends.push({ op: 'item', id, x: it.x, y: it.y })
      }
    }
    placeStamps(board)
    if (chosen) chosen.box = boxAround([...chosen.items], [...chosen.frames])
    renderItems()
    try {
      await sendAll(sends)
      renderItems()
    } catch (err) {
      hint(err.message, 3000)
      takeBoardAgain()
    }
  }
  // Figma's flips (Shift+H across, Shift+V up and down): what is selected mirrored within the box round it, each
  // object's place turned over and a free line, arrow or stroke's own points with it; a line held by objects follows
  // them, a stamp stays on what it sits on, a locked one stays. One undo step.
  async function flipChosen(axis) {
    const list = selectedItems()
    if (!list.length) return
    const all = boxAround(list.map((i) => i.id))
    const sends = []
    for (const it of list) {
      if (isLocked(it.id) || (it.kind === 'stamp' && it.to) || (['line', 'arrow'].includes(it.kind) && (it.from || it.to))) continue
      const change = { op: 'item', id: it.id }
      if (axis === 'x') it.x = change.x = Math.round(2 * all.x + all.w - it.x - (it.w ?? 0))
      else it.y = change.y = Math.round(2 * all.y + all.h - it.y - (it.h ?? 0))
      if (Array.isArray(it.points) && it.points.length >= 4) {
        const k = axis === 'x' ? 0 : 1
        const own = it.points.filter((_, i) => i % 2 === k)
        const sum = Math.min(...own) + Math.max(...own)
        it.points = change.points = it.points.map((v, i) => (i % 2 === k ? sum - v : v))
      }
      sends.push(change)
    }
    if (!sends.length) return hint('Nothing selected can be flipped', 1600)
    placeStamps(board)
    if (chosen) chosen.box = boxAround([...chosen.items], [...chosen.frames])
    renderItems()
    try {
      await sendAll(sends)
      renderItems()
    } catch (err) {
      hint(err.message, 3000)
      takeBoardAgain()
    }
  }
  function alignChosen(how) {
    const units = selectedUnits()
    if (units.length < 2) return hint('Select two or more to align them', 1600)
    const all = boxAround(units.flatMap((u) => u.members))
    moveUnits(units.map(({ members, box: b }) => ({
      members,
      dx: how === 'left' ? all.x - b.x : how === 'center' ? all.x + all.w / 2 - (b.x + b.w / 2) : how === 'right' ? all.x + all.w - (b.x + b.w) : 0,
      dy: how === 'top' ? all.y - b.y : how === 'middle' ? all.y + all.h / 2 - (b.y + b.h / 2) : how === 'bottom' ? all.y + all.h - (b.y + b.h) : 0,
    })))
  }
  /** Equal gaps between neighbors across (x) or down (y), the first and last staying where they are. */
  function distributeChosen(axis) {
    const units = selectedUnits()
    if (units.length < 3) return hint('Select three or more to space them evenly', 1600)
    const [p, s] = axis === 'x' ? ['x', 'w'] : ['y', 'h']
    units.sort((a, b) => a.box[p] - b.box[p])
    const first = units[0].box
    const last = units[units.length - 1].box
    const gap = (last[p] + last[s] - first[p] - units.reduce((t, u) => t + u.box[s], 0)) / (units.length - 1)
    let at = first[p]
    moveUnits(units.map((u) => {
      const d = Math.round(at - u.box[p])
      at += u.box[s] + gap
      return { members: u.members, dx: axis === 'x' ? d : 0, dy: axis === 'y' ? d : 0 }
    }))
  }
  // Figma's Tidy up (Ctrl+Alt+T): what is selected put in a grid in reading order, a row or a column where it already
  // lies in one, each in a cell as big as the biggest, 40 apart, from where the selection starts. A stamp held by
  // something stays on it.
  function tidyChosen() {
    const units = selectedUnits().filter((u) => !u.members.every((id) => { const it = board.items.find((i) => i.id === id); return it?.kind === 'stamp' && it.to }))
    if (units.length < 2) return hint('Select two or more to tidy them up', 1600)
    const GAP = 40
    const all = boxAround(units.flatMap((u) => u.members))
    const cw = Math.max(...units.map((u) => u.box.w))
    const ch = Math.max(...units.map((u) => u.box.h))
    const mid = (u) => ({ x: u.box.x + u.box.w / 2, y: u.box.y + u.box.h / 2 })
    const inRow = units.every((u) => Math.abs(mid(u).y - mid(units[0]).y) < ch / 2)
    const inColumn = units.every((u) => Math.abs(mid(u).x - mid(units[0]).x) < cw / 2)
    const cols = inRow ? units.length : inColumn ? 1 : Math.ceil(Math.sqrt(units.length))
    // Reading order: by bands a cell high, then left to right.
    units.sort((a, b) => Math.floor((mid(a).y - all.y) / ch) - Math.floor((mid(b).y - all.y) / ch) || mid(a).x - mid(b).x)
    moveUnits(units.map((u, i) => ({
      members: u.members,
      dx: Math.round(all.x + (i % cols) * (cw + GAP) - u.box.x),
      dy: Math.round(all.y + Math.floor(i / cols) * (ch + GAP) - u.box.y),
    })))
  }
  function alignMenu(anchor) {
    const n = selectedUnits().length
    openMenu(anchor, [
      { label: 'Align left', key: 'Alt+A', run: () => alignChosen('left') },
      { label: 'Align centers', key: 'Alt+H', run: () => alignChosen('center') },
      { label: 'Align right', key: 'Alt+D', run: () => alignChosen('right') },
      '-',
      { label: 'Align top', key: 'Alt+W', run: () => alignChosen('top') },
      { label: 'Align middles', key: 'Alt+V', run: () => alignChosen('middle') },
      { label: 'Align bottom', key: 'Alt+S', run: () => alignChosen('bottom') },
      ...(n >= 3 ? ['-', { label: 'Space evenly across', key: 'Alt+Shift+H', run: () => distributeChosen('x') }, { label: 'Space evenly down', key: 'Alt+Shift+V', run: () => distributeChosen('y') }] : []),
      '-',
      { label: 'Tidy up', key: 'Ctrl+Alt+T', run: tidyChosen },
    ])
  }
  /** One color for every selected object that takes one. */
  async function colorChosen(color) {
    const ids = [...(chosen?.items ?? [])].filter((id) => !isLocked(id) && !['guide', 'image'].includes(board.items.find((i) => i.id === id)?.kind))
    for (const id of ids) Object.assign(board.items.find((i) => i.id === id), { color })
    renderItems()
    try {
      await sendAll(ids.map((id) => ({ op: 'item', id, color })))
    } catch (err) {
      hint(err.message, 3000)
      takeBoardAgain()
    }
  }
  async function removeChosen(all = [...(chosen?.items ?? [])]) {
    if (!all.length) return
    const ids = all.filter((id) => !isLocked(id))
    if (ids.length < all.length) hint(`${all.length - ids.length} locked, left where they are`, 2400)
    chosen = null
    // Gone at once, as in Figma, while their lines are saved.
    const saving = sendAll(ids.map((id) => ({ op: 'remove', id })))
    renderItems()
    try {
      await saving
    } catch (err) {
      hint(err.message, 3000)
    }
    renderItems()
  }
  // A drag box: from empty board, with the select tool, while editing.
  function startMarquee(e, p) {
    // Shift held, as in Figma: what the box takes in is added to what is selected, and a Shift+click on empty board
    // leaves the selection as it is.
    const adding = e.shiftKey
    const had = adding ? { items: chosen ? [...chosen.items] : picked ? withGroup(picked) : [], frames: chosen ? [...chosen.frames] : [] } : null
    const ghost = h('div', { class: 'draft-shape marquee' })
    world.append(ghost)
    let last = p
    const box = () => ({ x: Math.round(Math.min(p.x, last.x)), y: Math.round(Math.min(p.y, last.y)), w: Math.round(Math.abs(last.x - p.x)), h: Math.round(Math.abs(last.y - p.y)) })
    drag = {
      kind: 'marquee', id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false,
      move: (ev) => {
        last = toWorld(ev.clientX, ev.clientY)
        const b = box()
        Object.assign(ghost.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` })
      },
      end: (ev, moved) => {
        ghost.remove()
        if (!moved) return adding ? undefined : emptyClick(ev)
        if (adding) {
          const got = inside(box())
          return chooseItems([...new Set([...had.items, ...got.items])], [...new Set([...had.frames, ...got.frames])])
        }
        choose(box())
      },
    }
    viewport.setPointerCapture(e.pointerId)
  }
  function placeItemBar() {
    if (chosen) {
      const n = chosen.items.size + chosen.frames.size
      const its = [...chosen.items].map((id) => board.items.find((i) => i.id === id)).filter((i) => i && i.kind !== 'guide')
      // Every selected object takes the color clicked; the swatches are those of the kind most of them are.
      const paletteOf = (k) => (k === 'note' ? NOTE_COLORS : k === 'section' ? SECTION_COLORS : SHAPE_COLORS)
      const tinted = its.filter((i) => i.kind !== 'image')
      const colors = tinted.length ? paletteOf(tinted.filter((i) => i.kind === 'note').length * 2 > tinted.length ? 'note' : tinted.every((i) => i.kind === 'section') ? 'section' : 'shape') : []
      const same = tinted.length && tinted.every((i) => (i.color || paletteOf(i.kind)[0]) === (tinted[0].color || paletteOf(tinted[0].kind)[0])) ? tinted[0].color || paletteOf(tinted[0].kind)[0] : null
      // A group may hold screens as well as objects.
      const frameGroups = [...chosen.frames].map((k) => board.moved?.[k]?.group ?? null)
      const g = its[0]?.group ?? frameGroups[0]
      const grouped = !!g && its.length + frameGroups.length > 1 && its.every((i) => i.group === g) && frameGroups.every((x) => x === g)
      const anyGroup = its.some((i) => i.group) || frameGroups.some(Boolean)
      itemBar.replaceChildren(...[
        h('span', { class: 'count-note' }, grouped ? `Group of ${n}` : `${n} selected`),
        ...colors.map((c) => h('button', { type: 'button', class: `swatch${same === c ? ' on' : ''}`, style: `background:${c}`, title: COLOR_NAMES[c] ?? c, 'aria-label': COLOR_NAMES[c] ?? c, 'aria-pressed': String(same === c), onclick: () => colorChosen(c) })),
        colors.length ? h('span', { class: 'sep' }) : null,
        selectedUnits().length > 1 ? h('button', { type: 'button', class: 'tool', title: 'Align and space evenly', 'aria-haspopup': 'menu', onclick: (e) => alignMenu(e.currentTarget) }, 'Align', h('span', { class: 'caret' }, '▾')) : null,
        its.length > 1 && !grouped ? h('button', { type: 'button', class: 'tool', title: 'Group them: they move, color and delete as one (Ctrl+G)', onclick: () => groupChosen(true) }, 'Group') : null,
        anyGroup ? h('button', { type: 'button', class: 'tool', title: 'Ungroup (Ctrl+Shift+G)', onclick: () => groupChosen(false) }, 'Ungroup') : null,
        api ? h('button', { type: 'button', class: 'tool', title: 'Ask the agent about what is in the box', onclick: () => openAsk() }, '✦ Ask agent') : null,
        chosen.items.size ? h('button', { type: 'button', class: 'tool', title: 'Delete (Delete)', onclick: () => removeChosen() }, 'Delete') : null,
        pageButton(),
        ...(owner() ? [
          [...chosen.items, ...chosen.frames].some((k) => !isLocked(k)) ? h('button', { type: 'button', class: 'tool', title: 'Lock everything selected', onclick: () => setLock([...chosen.items, ...chosen.frames], true) }, icon('lock'), 'Lock') : null,
          [...chosen.items, ...chosen.frames].some(isLocked) ? h('button', { type: 'button', class: 'tool', title: 'Unlock everything selected', onclick: () => setLock([...chosen.items, ...chosen.frames].filter(isLocked), false) }, icon('unlock'), 'Unlock') : null,
        ] : []),
      ].filter(Boolean))
      const top = toScreen(chosen.box.x, chosen.box.y)
      // Shown first, so its own width keeps it on the screen (hidden, it measures nothing).
      itemBar.classList.add('open')
      itemBar.style.left = `${Math.max(8, Math.min(innerWidth - itemBar.offsetWidth - 8, top.x))}px`
      itemBar.style.top = `${Math.max(56, top.y - itemBar.offsetHeight - 8)}px`
      return
    }
    const it = picked && board.items.find((i) => i.id === picked)
    if (!it || it.kind === 'guide' && !findFrame(it.frame)) {
      itemBar.classList.remove('open')
      return
    }
    if (isLocked(it.id)) {
      itemBar.replaceChildren(
        owner()
          ? h('button', { type: 'button', class: 'tool', title: 'Unlock it', onclick: () => setLock([it.id], false) }, icon('lock'), 'Locked · Unlock')
          : h('span', { class: 'count-note' }, icon('lock'), 'Locked by its owner'),
      )
    } else {
    const colors = it.kind === 'note' ? NOTE_COLORS : it.kind === 'section' ? SECTION_COLORS : ['guide', 'image', 'stamp'].includes(it.kind) ? [] : SHAPE_COLORS
    itemBar.replaceChildren(...[
      ...colors.map((c) => h('button', { type: 'button', class: `swatch${(it.color || colors[0]) === c ? ' on' : ''}`, style: `background:${c}`, title: COLOR_NAMES[c] ?? c, 'aria-label': COLOR_NAMES[c] ?? c, 'aria-pressed': String((it.color || colors[0]) === c), onclick: () => updateItem(it.id, { color: c }) })),
      // A title's size: four steps, the middle one where a title starts.
      ...(it.kind === 'title' ? [h('span', { class: 'sep' }), ...[['S', 48], ['M', 96], ['L', 160], ['XL', 240]].map(([label, px]) => h('button', { type: 'button', class: `tool${(it.size || 96) === px ? ' on' : ''}`, title: `${px} px`, 'aria-pressed': String((it.size || 96) === px), onclick: () => updateItem(it.id, { size: px }) }, label))] : []),
      // A shape's kind, changed in place as FigJam's shape menu does: its box, words and the lines bound to it kept.
      ...(['rect', 'ellipse', 'diamond', 'triangle'].includes(it.kind) ? [h('span', { class: 'sep' }), ...['rect', 'ellipse', 'diamond', 'triangle'].map((k) => h('button', { type: 'button', class: `tool${it.kind === k ? ' on' : ''}`, title: SHAPE_NAMES[k].replace(/ \(.\)$/, ''), 'aria-label': SHAPE_NAMES[k].replace(/ \(.\)$/, ''), 'aria-pressed': String(it.kind === k), onclick: () => updateItem(it.id, { kind: k }) }, icon(k)))] : []),
      // A shape's inside, as FigJam's fill: clear, or filled with a tint of its color.
      ...(['rect', 'ellipse', 'diamond', 'triangle'].includes(it.kind) ? [h('span', { class: 'sep' }), ...[['', 'Outline only', '▢'], ['solid', 'Filled', '■']].map(([fill, label, glyph]) => {
        const on = (it.fill || '') === fill
        return h('button', { type: 'button', class: `tool${on ? ' on' : ''}`, title: label, 'aria-label': label, 'aria-pressed': String(on), onclick: () => updateItem(it.id, { fill }) }, glyph)
      })] : []),
      // A stroke, line or arrow's thickness: S, M, L (a highlighter keeps its width as its own).
      ...(['pencil', 'line', 'arrow'].includes(it.kind) && it.pen !== 'highlight' ? [h('span', { class: 'sep' }), ...[['S', 3], ['M', it.kind === 'pencil' ? 5 : 4], ['L', 10]].map(([label, w]) => h('button', { type: 'button', class: `tool${(Number(it.weight) || (it.kind === 'pencil' ? 5 : 4)) === w ? ' on' : ''}`, title: `${w} px thick`, 'aria-pressed': String((Number(it.weight) || (it.kind === 'pencil' ? 5 : 4)) === w), onclick: () => updateItem(it.id, { weight: w }) }, label))] : []),
      // A line's ends, as FigJam's: none (a line), a head at its end (an arrow), or heads at both.
      ...(it.kind === 'line' || it.kind === 'arrow' ? [h('span', { class: 'sep' }), ...[['line', '', 'No heads', '—'], ['arrow', '', 'Head at the end', '→'], ['arrow', 'both', 'Heads at both ends', '↔']].map(([kind, ends, label, glyph]) => {
        const on = it.kind === kind && (kind === 'line' || (it.ends || '') === ends)
        return h('button', { type: 'button', class: `tool${on ? ' on' : ''}`, title: label, 'aria-label': label, 'aria-pressed': String(on), onclick: () => updateItem(it.id, { kind, ends }) }, glyph)
      }), ...[['', 'Solid line', 'Solid'], ['dash', 'Dashed line', 'Dashed']].map(([dash, label, glyph]) => {
        const on = (it.dash || '') === dash
        return h('button', { type: 'button', class: `tool${on ? ' on' : ''}`, title: label, 'aria-label': label, 'aria-pressed': String(on), onclick: () => updateItem(it.id, { dash }) }, glyph)
      })] : []),
      // FigJam's Show author: who wrote the note, at its foot.
      ...(it.kind === 'note' && it.by ? [h('span', { class: 'sep' }), h('button', { type: 'button', class: `tool${it.author === 'show' ? ' on' : ''}`, title: it.author === 'show' ? `Hide the name ${it.by}` : `Show who wrote it (${it.by}) at the foot of the note`, 'aria-pressed': String(it.author === 'show'), onclick: () => updateItem(it.id, { author: it.author === 'show' ? '' : 'show' }) }, 'Name')] : []),
      // A line or arrow's way: Straight, Elbow or Curve.
      ...((it.kind === 'line' || it.kind === 'arrow') && (it.points?.length ?? 0) === 4 ? [h('span', { class: 'sep' }), ...[['', 'Straight'], ['elbow', 'Elbow'], ['curve', 'Curve']].map(([route, label]) => h('button', { type: 'button', class: `tool${(it.route || '') === route ? ' on' : ''}`, title: `${label} line`, 'aria-pressed': String((it.route || '') === route), onclick: () => updateItem(it.id, { route }) }, label))] : []),
      ...(it.kind === 'guide'
        ? [
            h('label', {}, 'Cols', h('input', { type: 'number', min: 1, max: 24, value: it.cols || 12, onchange: (e) => updateItem(it.id, { cols: Number(e.target.value) || 12 }) })),
            h('label', {}, 'Gutter', h('input', { type: 'number', min: 0, max: 200, value: (it.gutter === '' ? 24 : it.gutter ?? 24), onchange: (e) => updateItem(it.id, { gutter: Number(e.target.value) || 0 }) })),
            h('label', {}, 'Margin', h('input', { type: 'number', min: 0, max: 600, value: (it.margin === '' ? 80 : it.margin ?? 80), onchange: (e) => updateItem(it.id, { margin: Number(e.target.value) || 0 }) })),
          ]
        : []),
      h('span', { class: 'sep' }),
      h('button', { type: 'button', class: 'tool', title: 'Delete (Delete)', onclick: () => removeItem(it.id) }, 'Delete'),
      it.kind === 'guide' ? null : pageButton(),
      owner() ? h('button', { type: 'button', class: 'tool', title: 'Lock it: nobody moves, changes or deletes it, and visitors put nothing over it', onclick: () => setLock([it.id], true) }, icon('unlock'), 'Lock') : null,
    ].filter(Boolean))
    }
    const f = it.kind === 'guide' ? findFrame(it.frame) : null
    const top = toScreen(f ? f.x : it.x, f ? f.y : it.y)
    itemBar.classList.add('open')
    itemBar.style.left = `${Math.max(8, Math.min(innerWidth - itemBar.offsetWidth - 8, top.x))}px`
    itemBar.style.top = `${Math.max(56, top.y - itemBar.offsetHeight - 8)}px`
  }
  async function updateItem(id, change) {
    const it = board.items.find((i) => i.id === id)
    if (!it) return
    if (isLocked(id)) return hint(LOCKED, 2000)
    Object.assign(it, change)
    renderItems()
    try {
      await sendBoard({ op: 'item', id, ...change })
    } catch (err) {
      hint(err.message, 3000)
      takeBoardAgain()
    }
  }
  async function removeItem(id) {
    if (!id) return
    if (isLocked(id)) return hint(LOCKED, 2000)
    picked = null
    try {
      await sendBoard({ op: 'remove', id })
    } catch (err) {
      hint(err.message, 3000)
    }
    renderItems()
  }
  async function addItem(item) {
    try {
      const ev = await sendBoard({ op: 'item', page: pageId, ...item })
      return ev.id
    } catch (err) {
      hint(err.message, 3000)
      return null
    }
  }
  // FigJam's Create section (Ctrl+Alt+G): a section drawn round what is selected, 60 clear of it on every side (more
  // above screens, for their labels), picked with its name being typed; it carries them from then on. One undo step.
  async function sectionAround() {
    const ids = selectedItems().map((i) => i.id)
    const keys = chosen ? [...chosen.frames] : []
    if (!ids.length && !keys.length) return
    const b = boxAround(ids, keys)
    const pad = 60
    const top = pad + (keys.length ? 80 : 0)
    const id = await addItem({ kind: 'section', x: Math.round(b.x - pad), y: Math.round(b.y - top), w: Math.round(b.w + 2 * pad), h: Math.round(b.h + pad + top), text: 'Section' })
    if (!id) return
    renderItems()
    pickItem(id)
    editItemText(id)
  }
  // FigJam's templates: a board laid out for a common session, put in the middle of the view in one undo step and
  // left selected, so a drag moves it all. An arrow's `from` and `to` name the parts it joins by their place in the list.
  const TEMPLATES = [
    { name: 'Retro', parts: [
      { kind: 'title', x: 0, y: 0, text: 'Retro', size: 96 },
      ...[['Went well', 4, 4], ['To change', 5, 5], ['To try', 1, 1]].flatMap(([text, sc, nc], i) => [
        { kind: 'section', x: i * 760, y: 220, w: 720, h: 900, text, color: SECTION_COLORS[sc] },
        { kind: 'note', x: i * 760 + 40, y: 300, w: 300, h: 220, text: '', color: NOTE_COLORS[nc] }]),
    ] },
    { name: 'Kanban', parts: [
      { kind: 'title', x: 0, y: 0, text: 'Board', size: 96 },
      ...[['To do', 1, 1], ['Doing', 5, 5], ['Done', 4, 4]].flatMap(([text, sc, nc], i) => [
        { kind: 'section', x: i * 560, y: 220, w: 520, h: 1100, text, color: SECTION_COLORS[sc] },
        ...(i ? [] : [{ kind: 'note', x: 40, y: 300, w: 300, h: 200, text: '', color: NOTE_COLORS[nc] }])]),
    ] },
    { name: 'Journey map', parts: [
      { kind: 'title', x: 0, y: 0, text: 'Journey', size: 96 },
      ...['Doing', 'Thinking', 'Feeling'].map((text, r) => ({ kind: 'title', x: 0, y: 340 + r * 300, text, size: 48 })),
      ...['Discover', 'Sign up', 'First use', 'Habit', 'Recommend'].map((text, i) => ({ kind: 'section', x: 320 + i * 520, y: 220, w: 480, h: 1000, text, color: SECTION_COLORS[i % SECTION_COLORS.length] })),
    ] },
    { name: 'Flowchart', parts: [
      { kind: 'title', x: 0, y: 0, text: 'Flow', size: 96 },
      { kind: 'ellipse', x: 0, y: 220, w: 280, h: 160, text: 'Start', color: SHAPE_COLORS[4] },
      { kind: 'rect', x: 440, y: 200, w: 320, h: 200, text: 'A step', color: SHAPE_COLORS[1] },
      { kind: 'diamond', x: 920, y: 170, w: 340, h: 260, text: 'A choice?', color: SHAPE_COLORS[5] },
      { kind: 'rect', x: 1420, y: 200, w: 320, h: 200, text: 'Done', color: SHAPE_COLORS[4] },
      ...[[1, 2], [2, 3], [3, 4]].map(([from, to]) => ({ kind: 'arrow', from, to })),
    ] },
  ]
  async function placeTemplate(t) {
    if (!serve) return hint(readOnly, 2000)
    const boxes = t.parts.filter((q) => q.kind !== 'arrow')
    const left = Math.min(...boxes.map((q) => q.x))
    const top = Math.min(...boxes.map((q) => q.y))
    const right = Math.max(...boxes.map((q) => q.x + (q.w ?? 600)))
    const bottom = Math.max(...boxes.map((q) => q.y + (q.h ?? (q.size ?? 96) * 1.3)))
    const mid = toWorld(innerWidth / 2, innerHeight / 2)
    let ox = Math.round(mid.x - (left + right) / 2)
    let oy = Math.round(mid.y - (top + bottom) / 2)
    // In the middle of the view where that is clear board; where it would land on screens or objects (or on locked
    // work, which a visitor may not cover), beside everything on the page instead.
    const span = { x: left + ox, y: top + oy, w: right - left, h: bottom - top }
    const hits = (r) => r.x < span.x + span.w && span.x < r.x + r.w && r.y < span.y + span.h && span.y < r.y + r.h
    const there = [...items().filter((i) => i.kind !== 'guide').map(geometryOf).map((i) => ({ x: i.x, y: i.y, w: i.w ?? 0, h: i.h ?? 0 })), ...frames().map((f) => ({ x: f.x, y: f.y, w: f.W, h: f.H }))]
    if (there.some(hits)) {
      const all = boxAround(items().map((i) => i.id), frames().map((f) => f.key))
      ox = Math.round(all.x + all.w + 400 - left)
      oy = Math.round(all.y - top)
    }
    const ids = []
    for (const q of t.parts) {
      let it = { ...q, x: q.x + ox, y: q.y + oy }
      if (q.kind === 'arrow') {
        const a = t.parts[q.from]
        const b = t.parts[q.to]
        const ax = a.x + a.w + ox
        const ay = a.y + a.h / 2 + oy
        const bx = b.x + ox
        const by = b.y + b.h / 2 + oy
        it = { kind: 'arrow', x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.max(1, Math.abs(bx - ax)), h: Math.max(1, Math.abs(by - ay)), points: [ax - Math.min(ax, bx), ay - Math.min(ay, by), bx - Math.min(ax, bx), by - Math.min(ay, by)], from: ids[q.from], to: ids[q.to] }
      }
      const id = await addItem(it)
      if (!id) break
      ids.push(id)
    }
    renderItems()
    if (!ids.length) return
    chooseItems(ids)
    fitTo(boxAround(ids, []), 80, 1)
  }
  const templateMenu = (anchor) => openMenu(anchor, TEMPLATES.map((t) => ({ label: t.name, run: () => placeTemplate(t) })))
  // ── snapping: what is dragged lines up with what it passes, and the line it lines up on is drawn ──
  const SNAP_PX = 6
  let snapEls = []
  const clearSnap = () => {
    for (const el of snapEls) el.remove()
    snapEls = []
  }
  /** For a drag of these objects and frames: a function from the drag's offset to the offset caught on the nearest edge or center. */
  function snapper(ids, keys) {
    const start = boxAround(ids, keys)
    if (!start.w && !start.h) return null
    const skip = new Set(ids)
    const others = [
      ...items().filter((i) => !skip.has(i.id) && i.kind !== 'guide' && !['line', 'arrow', 'pencil'].includes(i.kind)).map(geometryOf).filter((i) => i.w && i.h).map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h })),
      ...frames().filter((f) => !keys.includes(f.key)).map((f) => ({ x: f.x, y: f.y, w: f.W, h: f.H })),
    ]
    const marks = (b, p, s) => [b[p], b[p] + b[s] / 2, b[p] + b[s]]
    const along = (p, s) => others.flatMap((o) => marks(o, p, s).map((v) => ({ v, o })))
    const xs = along('x', 'w')
    const ys = along('y', 'h')
    const nearest = (mine, list) => {
      let best = null
      for (const m of mine) for (const t of list) {
        const d = t.v - m
        if (Math.abs(d) <= SNAP_PX / view.z && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t.v, o: t.o }
      }
      return best
    }
    // Figma's smart spacing: along a row (or a column) of what overlaps it across, a dragged object catches the middle
    // between its two neighbors, or a gap one of its neighbors already keeps with the next. p and s are the axis
    // moved along (x, w or y, h); q and t the one across.
    const spacing = (b, p, s, q, t) => {
      const row = others.filter((o) => o[q] < b[q] + b[t] && o[q] + o[t] > b[q]).sort((a, c) => a[p] - c[p])
      const end = (o) => o[p] + o[s]
      const before = row.filter((o) => end(o) <= b[p] + 1).sort((a, c) => end(c) - end(a))[0]
      const after = row.filter((o) => o[p] >= b[p] + b[s] - 1)[0]
      const targets = []
      if (before && after && after[p] - end(before) > b[s]) targets.push({ v: (end(before) + after[p] - b[s]) / 2, before, after })
      for (let i = 1; i < row.length; i++) {
        const g = row[i][p] - end(row[i - 1])
        if (g <= 0) continue
        const pair = [row[i - 1], row[i]]
        if (before) targets.push({ v: end(before) + g, before, pair, g })
        if (after) targets.push({ v: after[p] - g - b[s], after, pair, g })
      }
      let best = null
      for (const tg of targets) {
        const d = tg.v - b[p]
        if (Math.abs(d) <= SNAP_PX / view.z && (!best || Math.abs(d) < Math.abs(best.d))) best = { ...tg, d }
      }
      return best
    }
    /** The gap marks: a pink bar across each equal gap, its width written on it. */
    const gapMark = (axis, from, to, at) => {
      const len = to - from
      if (len <= 0) return
      const style = axis === 'x' ? `left:${from}px;top:${at}px;width:${len}px` : `top:${from}px;left:${at}px;height:${len}px`
      snapEls.push(h('div', { class: `snap-gap ${axis === 'x' ? 'h' : 'v'}`, style }, h('span', {}, String(Math.round(len)))))
    }
    const showGaps = (g, b, p, s, q, t) => {
      const mid = (o) => o[q] + o[t] / 2
      const end = (o) => o[p] + o[s]
      if (g.before) gapMark(p, end(g.before), b[p], (mid(g.before) + mid(b)) / 2)
      if (g.after) gapMark(p, end(b), g.after[p], (mid(g.after) + mid(b)) / 2)
      if (g.pair) gapMark(p, end(g.pair[0]), g.pair[1][p], (mid(g.pair[0]) + mid(g.pair[1])) / 2)
    }
    return (dx, dy) => {
      const b = { x: start.x + dx, y: start.y + dy, w: start.w, h: start.h }
      let sx = nearest(marks(b, 'x', 'w'), xs)
      let sy = nearest(marks(b, 'y', 'h'), ys)
      const gx = spacing(b, 'x', 'w', 'y', 'h')
      const gy = spacing(b, 'y', 'h', 'x', 'w')
      if (gx && (!sx || Math.abs(gx.d) < Math.abs(sx.d))) sx = null
      else if (gx) gx.skip = true
      if (gy && (!sy || Math.abs(gy.d) < Math.abs(sy.d))) sy = null
      else if (gy) gy.skip = true
      if (sx) b.x += sx.d
      else if (gx) b.x += gx.d
      if (sy) b.y += sy.d
      else if (gy) b.y += gy.d
      clearSnap()
      if (gx && !gx.skip) showGaps(gx, b, 'x', 'w', 'y', 'h')
      if (gy && !gy.skip) showGaps(gy, b, 'y', 'h', 'x', 'w')
      if (sx) {
        const top = Math.min(b.y, sx.o.y) - 12 / view.z
        snapEls.push(h('div', { class: 'snap-line v', style: `left:${sx.at}px;top:${top}px;height:${Math.max(b.y + b.h, sx.o.y + sx.o.h) + 12 / view.z - top}px` }))
      }
      if (sy) {
        const left = Math.min(b.x, sy.o.x) - 12 / view.z
        snapEls.push(h('div', { class: 'snap-line h', style: `top:${sy.at}px;left:${left}px;width:${Math.max(b.x + b.w, sy.o.x + sy.o.w) + 12 / view.z - left}px` }))
      }
      world.append(...snapEls)
      return { dx: dx + (sx?.d ?? (gx && !gx.skip ? gx.d : 0)), dy: dy + (sy?.d ?? (gy && !gy.skip ? gy.d : 0)) }
    }
  }
  // ── measure on the board: Alt held, with board objects selected, over another object shows how far apart they are,
  // as Figma's red lines: the gap across and the gap down where they face each other, or, one inside the other, its
  // distance to each side; in board pixels, the one pointed at outlined.
  let measureEls = []
  const clearMeasure = () => { for (const e of measureEls) e.remove(); measureEls = [] }
  function measureBoard(A, B) {
    clearMeasure()
    const line = (horiz, fixed, p, q) => {
      if (Math.round(Math.abs(q - p)) < 1) return
      const [s, e] = [Math.min(p, q), Math.max(p, q)]
      const style = horiz ? `left:${s}px;top:${fixed}px;width:${e - s}px` : `top:${s}px;left:${fixed}px;height:${e - s}px`
      measureEls.push(h('div', { class: `snap-gap measure ${horiz ? 'h' : 'v'}`, style }, h('span', {}, String(Math.round(e - s)))))
    }
    const r = (b) => ({ left: b.x, top: b.y, right: b.x + b.w, bottom: b.y + b.h })
    const a = r(A)
    const b = r(B)
    const inside = (o, i) => i.left >= o.left && i.right <= o.right && i.top >= o.top && i.bottom <= o.bottom
    if (inside(b, a) || inside(a, b)) {
      const [i, o] = inside(b, a) ? [a, b] : [b, a]
      const my = (i.top + i.bottom) / 2
      const mx = (i.left + i.right) / 2
      line(true, my, o.left, i.left)
      line(true, my, i.right, o.right)
      line(false, mx, o.top, i.top)
      line(false, mx, i.bottom, o.bottom)
    } else {
      const oy = [Math.max(a.top, b.top), Math.min(a.bottom, b.bottom)]
      const ox = [Math.max(a.left, b.left), Math.min(a.right, b.right)]
      const y = oy[0] < oy[1] ? (oy[0] + oy[1]) / 2 : (a.top + a.bottom) / 2
      const x = ox[0] < ox[1] ? (ox[0] + ox[1]) / 2 : (a.left + a.right) / 2
      if (b.left >= a.right) line(true, y, a.right, b.left)
      else if (a.left >= b.right) line(true, y, b.right, a.left)
      if (b.top >= a.bottom) line(false, x, a.bottom, b.top)
      else if (a.top >= b.bottom) line(false, x, b.bottom, a.top)
    }
    measureEls.push(h('div', { class: 'measure-to', style: `left:${B.x}px;top:${B.y}px;width:${B.w}px;height:${B.h}px` }))
    world.append(...measureEls)
  }
  viewport.addEventListener('pointermove', (e) => {
    const ids = selectedItems().map((i) => i.id)
    if (!e.altKey || drag || !ids.length || call('selectedFile')) return measureEls.length && clearMeasure()
    const id = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.item')?.dataset.id
    const it = id && !ids.includes(id) ? board.items.find((i) => i.id === id) : null
    if (!it || it.kind === 'guide') return measureEls.length && clearMeasure()
    const g = geometryOf(it)
    measureBoard(boxAround(ids, chosen ? [...chosen.frames] : []), { x: g.x, y: g.y, w: g.w ?? 0, h: g.h ?? 0 })
  })
  addEventListener('keyup', (e) => e.key === 'Alt' && clearMeasure())
  addEventListener('blur', clearMeasure)
  /** A corner pulled, as Figma's: the right and bottom edges catch on other objects' and frames' edges and centers near
   *  them, the line caught on drawn. Returns how far each edge moves to catch. */
  function edgeCatcher(id) {
    const others = [
      ...items().filter((i) => i.id !== id && i.kind !== 'guide' && !['line', 'arrow', 'pencil'].includes(i.kind)).map(geometryOf).filter((i) => i.w && i.h),
      ...frames().map((f) => ({ x: f.x, y: f.y, w: f.W, h: f.H })),
    ]
    const xs = others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w].map((v) => ({ v, o })))
    const ys = others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h].map((v) => ({ v, o })))
    const near = (m, list) => list.reduce((best, t) => (Math.abs(t.v - m) <= SNAP_PX / view.z && (!best || Math.abs(t.v - m) < Math.abs(best.v - m)) ? t : best), null)
    return (it) => {
      const sx = near(it.x + it.w, xs)
      const sy = near(it.y + it.h, ys)
      clearSnap()
      if (sx) {
        const top = Math.min(it.y, sx.o.y) - 12 / view.z
        snapEls.push(h('div', { class: 'snap-line v', style: `left:${sx.v}px;top:${top}px;height:${Math.max(it.y + it.h, sx.o.y + sx.o.h) + 12 / view.z - top}px` }))
      }
      if (sy) {
        const left = Math.min(it.x, sy.o.x) - 12 / view.z
        snapEls.push(h('div', { class: 'snap-line h', style: `top:${sy.v}px;left:${left}px;width:${Math.max(it.x + it.w, sy.o.x + sy.o.w) + 12 / view.z - left}px` }))
      }
      return { dw: sx ? Math.round(sx.v - (it.x + it.w)) : 0, dh: sy ? Math.round(sy.v - (it.y + it.h)) : 0 }
    }
  }
  /** The arrow keys move what is selected on the board, as Figma nudges: 1 px, 10 with Shift. A section takes what is
   *  inside it; a line bound to objects stays with them. One key press is one undo step. */
  /** Figma's arrows on a selected frame: the whole screen selected in it moves on the board, 1 or 10 at a time. */
  async function nudgeScreen(f, dx, dy) {
    if (!serve) return
    if (isLocked(f.key)) return hint(LOCKED, 1800)
    Object.assign(f, { x: f.x + dx, y: f.y + dy })
    positionFrame(f)
    renderItems()
    renderPins()
    call('onView')
    try {
      await sendAll([{ op: 'move', key: f.key, x: f.x, y: f.y, page: pageId }])
    } catch (err) {
      hint(err.message, 3000)
      takeBoardAgain()
    }
  }
  async function nudgeBoard(dx, dy) {
    const it = picked ? board.items.find((i) => i.id === picked) : null
    const along = chosen ? { items: [...chosen.items], frames: [...chosen.frames] } : it ? (it.kind === 'section' ? inside(it) : { items: [it.id], frames: [] }) : null
    if (!along) return false
    if (it && !along.items.includes(it.id)) along.items.push(it.id)
    const moving = along.items.map((x) => board.items.find((i) => i.id === x)).filter((i) => i && i.kind !== 'guide' && !isLocked(i.id) && !i.from && !i.to)
    const frameList = along.frames.map((k) => allFrames.get(k)).filter((f) => f && !isLocked(f.key))
    if (!moving.length && !frameList.length) {
      if (along.items.some(isLocked) || along.frames.some(isLocked)) hint('Its owner locked this, so it stays where it is.', 1800)
      return true
    }
    for (const m of moving) Object.assign(m, { x: m.x + dx, y: m.y + dy })
    for (const f of frameList) {
      Object.assign(f, { x: f.x + dx, y: f.y + dy })
      positionFrame(f)
    }
    if (chosen) Object.assign(chosen.box, { x: chosen.box.x + dx, y: chosen.box.y + dy })
    renderItems()
    if (frameList.length) renderPins()
    try {
      await sendAll([...moving.map((m) => ({ op: 'item', id: m.id, x: m.x, y: m.y })), ...frameList.map((f) => ({ op: 'move', key: f.key, x: f.x, y: f.y, page: pageId }))])
    } catch (err) {
      hint(err.message, 3000)
      takeBoardAgain()
    }
    return true
  }
  /** Shift held while dragging keeps the move to one axis, the one it has gone further along, as in Figma. */
  const straight = (ev, dx, dy) => (ev?.shiftKey ? (Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy }) : { dx, dy })
  function startItemDrag(e, id) {
    const it = board.items.find((i) => i.id === id)
    if (!it) return
    if (e.shiftKey) return toggleChosen(id)
    // A press on one object of a group takes the whole group; with Ctrl held (Figma's deep select) the one object. A
    // click that does not move, on one of several chosen together (a drag box, Ctrl+A) and not just its group, then
    // takes that one alone, as Figma does; a group selected stays selected.
    const deep = e.ctrlKey || e.metaKey
    const own = new Set([...withGroup(id), ...groupFrames(it.group)])
    const within = !deep && chosen?.items.has(id) && chosen.items.size + chosen.frames.size > 1 && !(chosen.items.size + chosen.frames.size === own.size && [...chosen.items, ...chosen.frames].every((k) => own.has(k)))
    if (!deep && !chosen?.items.has(id) && (withGroup(id).length > 1 || groupFrames(it.group).length)) chooseItems(withGroup(id), groupFrames(it.group))
    const group = !deep && chosen?.items.has(id) ? chosen : null
    if (!group) pickItem(id)
    if (it.kind === 'guide') return
    if (!group && isLocked(id)) return
    // Near the bottom-right corner it resizes; anywhere else it moves.
    const p = toWorld(e.clientX, e.clientY)
    const resize = !group && ['note', 'rect', 'ellipse', 'diamond', 'triangle', 'section', 'image'].includes(it.kind) && p.x > it.x + it.w - 24 / view.z && p.y > it.y + it.h - 24 / view.z
    const w0 = it.w
    const h0 = it.h
    const x0 = it.x
    const y0 = it.y
    // What moves with it: everything a drag box took in, or everything inside a section.
    const along = group ? { items: [...group.items], frames: [...group.frames] } : it.kind === 'section' && !resize ? inside(it) : { items: [id], frames: [] }
    if (!along.items.includes(id)) along.items.push(id)
    // A line moved by hand lets go of what it held, and stays where it was drawn.
    const moving = along.items.map((x) => board.items.find((i) => i.id === x)).filter((i) => i && i.kind !== 'guide' && !isLocked(i.id))
    // Alt held: the drag places copies where it ends, and what was dragged goes back where it was.
    const copying = e.altKey && !resize && serve
    const originals = copying ? moving.map((m) => ({ ...m })) : null
    let last = { dx: 0, dy: 0 }
    for (const m of moving) {
      if (copying || m.id !== id || (!m.from && !m.to)) continue
      Object.assign(m, geometryOf(m), { from: '', to: '' })
    }
    const starts = new Map(moving.map((m) => [m.id, { x: m.x, y: m.y }]))
    const frameList = copying ? [] : along.frames.map((k) => allFrames.get(k)).filter((f) => f && !isLocked(f.key))
    const frameStarts = new Map(frameList.map((f) => [f.key, { x: f.x, y: f.y }]))
    const boxStart = group ? { ...group.box } : null
    const snap = resize ? null : snapper(moving.map((m) => m.id), frameList.map((f) => f.key))
    const catchEdge = resize ? edgeCatcher(id) : null
    drag = {
      kind: 'item', id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false,
      move: (ev, dx, dy) => {
        // A picture keeps its proportions, as a placed image does in FigJam; Shift lets them go.
        // A shape or note with Shift held keeps its proportions, as in Figma.
        // Alt held resizes from the middle, as in Figma: each side moves as far as the corner, the middle stays.
        const twice = resize && ev.altKey ? 2 : 1
        if (resize && (it.kind === 'image') !== !!ev.shiftKey) {
          const w = Math.max(40, Math.round(w0 + dx * twice))
          Object.assign(it, { w, h: Math.max(20, Math.round((w * h0) / Math.max(1, w0))) })
        } else if (resize) Object.assign(it, { w: Math.max(40, Math.round(w0 + dx * twice)), h: Math.max(30, Math.round(h0 + dy * twice)) })
        if (resize) {
          Object.assign(it, ev.altKey ? { x: Math.round(x0 + (w0 - it.w) / 2), y: Math.round(y0 + (h0 - it.h) / 2) } : { x: x0, y: y0 })
          // A plain corner pull catches the edges near it; Shift, Alt and Ctrl keep their own ways.
          if (catchEdge && !ev.shiftKey && !ev.altKey && !(ev.ctrlKey || ev.metaKey) && it.kind !== 'image') {
            const c = catchEdge(it)
            Object.assign(it, { w: Math.max(40, it.w + c.dw), h: Math.max(30, it.h + c.dh) })
          }
        } else {
          ;({ dx, dy } = straight(ev, dx, dy))
          const across = ev.shiftKey && !dy
          // Edges and centers catch on other objects' and frames' edges and centers; Ctrl or ⌘ held lets go.
          ;({ dx, dy } = snap && !(ev.ctrlKey || ev.metaKey) ? snap(dx, dy) : (clearSnap(), { dx, dy }))
          // A catch never takes it off the axis Shift holds it to.
          if (ev.shiftKey) across ? (dy = 0) : (dx = 0)
          last = { dx, dy }
          for (const m of moving) Object.assign(m, { x: Math.round(starts.get(m.id).x + dx), y: Math.round(starts.get(m.id).y + dy) })
          for (const f of frameList) {
            Object.assign(f, { x: Math.round(frameStarts.get(f.key).x + dx), y: Math.round(frameStarts.get(f.key).y + dy) })
            positionFrame(f)
          }
          if (group) Object.assign(group.box, { x: Math.round(boxStart.x + dx), y: Math.round(boxStart.y + dy) })
        }
        // The bar would sit over what is being moved, and the connector dots over the snap marks; they come back where
        // the drag ends.
        itemBar.classList.add('dragging')
        document.body.classList.add('item-dragging')
        renderItems()
        // Resizing, its size under it as it changes, as Figma's: width × height in board pixels.
        if (resize) {
          if (!catchEdge || ev.shiftKey || ev.altKey || ev.ctrlKey || ev.metaKey || it.kind === 'image') clearSnap()
          for (const e of snapEls.filter((x) => x.classList.contains('size-tag'))) e.remove()
          snapEls = snapEls.filter((x) => !x.classList.contains('size-tag'))
          snapEls.push(h('div', { class: 'size-tag', style: `left:${it.x + it.w / 2}px;top:${it.y + it.h}px` }, `${it.w} × ${it.h}`))
        }
        if (snapEls.length) world.append(...snapEls)
        if (frameList.length) {
          renderPins()
          call('onView')
        }
      },
      end: async (_, moved) => {
        clearSnap()
        itemBar.classList.remove('dragging')
        document.body.classList.remove('item-dragging')
        if (!moved) return within && pickItem(id)
        if (resize) return updateItem(id, it.x !== x0 || it.y !== y0 ? { x: it.x, y: it.y, w: it.w, h: it.h } : { w: it.w, h: it.h })
        if (copying) {
          for (const m of moving) Object.assign(m, starts.get(m.id))
          renderItems()
          return placeCopies(originals, last.dx, last.dy)
        }
        try {
          for (const m of moving) {
            const change = { x: m.x, y: m.y }
            if (m.kind !== 'stamp' && (m.from === '' || m.to === '')) Object.assign(change, { w: m.w, h: m.h, points: m.points, from: '', to: '' })
            if (m.kind === 'stamp') Object.assign(change, stampAt(m.x, m.y))
            await sendBoard({ op: 'item', id: m.id, ...change })
          }
          await sendAll(frameList.map((f) => ({ op: 'move', key: f.key, x: f.x, y: f.y, page: pageId })))
        } catch (err) {
          hint(err.message, 3000)
          takeBoardAgain()
        }
        renderItems()
      },
    }
    viewport.setPointerCapture(e.pointerId)
  }
  function editItemText(id) {
    const it = board.items.find((i) => i.id === id)
    if (!it || !['note', 'title', 'rect', 'ellipse', 'diamond', 'triangle', 'section', 'line', 'arrow'].includes(it.kind)) return
    if (!serve) return
    if (isLocked(id)) return hint(LOCKED, 2000)
    const box = (it.kind === 'section' ? sectionLayer : itemLayer).querySelector(`[data-id="${id}"]`)
    // A line with no label yet gets an empty one on its middle to type into.
    if (box && (it.kind === 'line' || it.kind === 'arrow') && !box.querySelector('.txt')) {
      const pts = (geometryOf(it).points ?? []).map(Number)
      if (pts.length < 4) return
      box.append(h('div', { class: 'txt line-label', style: `left:${(pts[0] + pts[pts.length - 2]) / 2}px;top:${(pts[1] + pts[pts.length - 1]) / 2}px` }))
    }
    const el = box?.querySelector('.txt') ?? box
    if (!el) return
    box.querySelector('.grip')?.remove()
    box.querySelector('.by')?.remove()
    box.classList.add('editing')
    el.contentEditable = 'plaintext-only'
    el.focus({ preventScroll: true })
    document.getSelection().selectAllChildren(el)
    const done = () => {
      el.removeEventListener('blur', done)
      el.contentEditable = 'false'
      const text = el.innerText.replace(/\n$/, '')
      // A note or shape given more words than it holds grows down to hold them all, so none is hidden under its edge
      // or spills over what is beside it; an ellipse holds its words in the box inside its curve.
      const over = it.kind === 'note' ? box.scrollHeight - box.clientHeight
        : it.kind === 'rect' ? el.scrollHeight - box.clientHeight
        : it.kind === 'ellipse' ? Math.ceil(el.scrollHeight * 1.42) - box.clientHeight
        : it.kind === 'diamond' || it.kind === 'triangle' ? Math.ceil(el.scrollHeight * 2.1) - box.clientHeight
        : 0
      const grow = over > 1 ? { h: Math.ceil(it.h + over + 8) } : {}
      if (text !== (it.text ?? '') || grow.h) updateItem(id, { text, ...grow })
      else renderItems()
    }
    el.addEventListener('blur', done)
    el.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape' || (e.key === 'Enter' && (it.kind === 'title' || it.kind === 'section' || e.metaKey || e.ctrlKey))) {
        e.preventDefault()
        el.blur()
      }
    })
  }
  async function newTitle(p) {
    if (!serve) return
    const id = await addItem({ kind: 'title', x: p.x, y: p.y, text: 'Title' })
    setTool('select')
    if (id) {
      renderItems()
      pickItem(id)
      editItemText(id)
    }
  }
  function startDraw(e, p, f, from = null) {
    if (!serve) return
    const kind = from?.kind ?? tool
    if (kind === 'stamp') {
      const x = Math.round(p.x - 24)
      const y = Math.round(p.y - 24)
      addItem({ kind: 'stamp', w: 48, h: 48, text: stampNow(), ...stampAt(x, y) }).then(() => renderItems())
      return
    }
    if (kind === 'guide') {
      if (!f) return hint('Click a screen to put a 12-column guide over it.')
      addItem({ kind: 'guide', frame: f.key, x: f.x, y: f.y, cols: 12, gutter: 24, margin: 80 }).then((id) => {
        setTool('select')
        if (id) pickItem(id)
      })
      return
    }
    const pts = [p.x, p.y]
    const ghost = h('div', { class: 'draft-shape' })
    const svgGhost = h('div', { class: 'item svg', style: 'left:0;top:0' })
    world.append(kind === 'pencil' || kind === 'line' || kind === 'arrow' ? svgGhost : ghost)
    let last = p
    // Where a box is drawn from: the press, or, with Alt held, the point opposite the pointer through it (Figma draws
    // from the middle).
    let from0 = p
    drag = {
      kind: 'draw', id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false,
      move: (ev) => {
        last = toWorld(ev.clientX, ev.clientY)
        // Shift held, as in Figma: a line or arrow keeps to every 45°, a shape, note, section or screen is square.
        if (ev.shiftKey && (kind === 'line' || kind === 'arrow')) {
          const step = Math.PI / 4
          const ang = Math.round(Math.atan2(last.y - p.y, last.x - p.x) / step) * step
          const len = Math.hypot(last.x - p.x, last.y - p.y)
          last = { x: Math.round(p.x + Math.cos(ang) * len), y: Math.round(p.y + Math.sin(ang) * len) }
        } else if (ev.shiftKey && kind !== 'pencil') {
          const dx = last.x - p.x
          const dy = last.y - p.y
          const side = Math.max(Math.abs(dx), Math.abs(dy))
          last = { x: p.x + Math.sign(dx || 1) * side, y: p.y + Math.sign(dy || 1) * side }
        }
        from0 = ev.altKey && !['pencil', 'line', 'arrow'].includes(kind) ? { x: 2 * p.x - last.x, y: 2 * p.y - last.y } : p
        if (kind === 'pencil') pts.push(Math.round(last.x), Math.round(last.y))
        if (kind === 'pencil' || kind === 'line' || kind === 'arrow') {
          const all = kind === 'pencil' ? pts : [p.x, p.y, last.x, last.y]
          const d = all.reduce((s, v, i) => s + (i % 2 ? `,${v}` : `${i ? ' L' : 'M'}${v}`), '')
          svgGhost.innerHTML = `<svg style="overflow:visible;position:absolute;left:0;top:0" width="1" height="1"><path d="${d}" fill="none" stroke="${kind === 'pencil' ? penColor() : '#3b82f6'}" stroke-opacity="${kind === 'pencil' && penNow()[3] ? 0.4 : 1}" stroke-width="${kind === 'pencil' ? penNow()[2] : 4 / Math.max(view.z, 0.2)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`
        } else {
          Object.assign(ghost.style, { left: `${Math.min(from0.x, last.x)}px`, top: `${Math.min(from0.y, last.y)}px`, width: `${Math.abs(last.x - from0.x)}px`, height: `${Math.abs(last.y - from0.y)}px` })
        }
      },
      end: async (_, moved) => {
        ghost.remove()
        svgGhost.remove()
        let x = Math.round(Math.min(from0.x, last.x))
        let y = Math.round(Math.min(from0.y, last.y))
        let w = Math.round(Math.abs(last.x - from0.x))
        let hgt = Math.round(Math.abs(last.y - from0.y))
        if (kind === 'artboard') {
          if (!moved || w < 40) {
            ;[, w, hgt] = artboardSize()
          }
          setTool('select')
          return newArtboard(x, y, w, hgt)
        }
        let item
        if (kind === 'pencil' || kind === 'line' || kind === 'arrow') {
          const all = kind === 'pencil' ? pts : [p.x, p.y, last.x, last.y]
          if (!moved && from?.side) return quickMake(from.from, from.side)
          if (!moved || all.length < 4) return
          const xs = all.filter((_, i) => i % 2 === 0)
          const ys = all.filter((_, i) => i % 2 === 1)
          x = Math.min(...xs)
          y = Math.min(...ys)
          w = Math.max(...xs) - x
          hgt = Math.max(...ys) - y
          item = { kind, x, y, w, h: hgt, points: all.map((v, i) => Math.round(v - (i % 2 ? y : x))), ...(kind === 'pencil' ? { weight: penNow()[2], color: penColor(), ...(penNow()[3] ? { pen: penNow()[3] } : {}) } : {}) }
          // A line or arrow begun or ended on an object or a frame holds on to it.
          if (kind !== 'pencil') {
            const start = from?.from ?? bindAt(p)
            let to = bindAt(last)
            if (start) item.from = start
            // Drawn from a connector dot and let go on empty board: a new one like the first, there, held at that end.
            if (from && (!to || to === start)) {
              const src = board.items.find((i) => i.id === from.from)
              if (src) {
                const made = await addItem({ kind: src.kind, x: Math.round(last.x - src.w / 2), y: Math.round(last.y - src.h / 2), w: src.w, h: src.h, text: '', ...(src.color ? { color: src.color } : {}) })
                if (made) { to = made; from.made = made }
              }
            }
            if (to && to !== start) item.to = to
          }
        } else {
          if (!moved || w < 10) {
            w = kind === 'note' ? 360 : kind === 'section' ? 1600 : 400
            hgt = kind === 'note' ? 260 : kind === 'section' ? 1000 : 300
            x = p.x
            y = p.y
          }
          item = { kind, x, y, w, h: hgt, ...(kind === 'note' ? { text: '', color: NOTE_COLORS[0] } : kind === 'section' ? { text: 'Section' } : {}) }
        }
        const id = await addItem(item)
        if (kind !== 'pencil') setTool('select')
        // A new one made at the arrow's end is picked, to type in.
        if (from?.made) {
          renderItems()
          pickItem(from.made)
          return editItemText(from.made)
        }
        if (id) {
          renderItems()
          if (kind !== 'pencil') pickItem(id)
          if (kind === 'note' || kind === 'section') editItemText(id)
        }
      },
    }
    viewport.setPointerCapture(e.pointerId)
  }
  /** FigJam's quick create: a new note or shape like this one, a gap away on the side whose dot was clicked, with an
   *  arrow from this one to it, picked to type in. Where that spot is taken it moves along until it is free. */
  async function quickMake(srcId, side) {
    const src = board.items.find((i) => i.id === srcId)
    if (!src) return
    const [dx, dy] = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[side]
    const gap = 120
    let x = src.x + dx * (src.w + gap)
    let y = src.y + dy * (src.h + gap)
    const solid = (i) => i.id !== src.id && !['line', 'arrow', 'pencil', 'section', 'guide'].includes(i.kind)
    const taken = () => items().some((i) => solid(i) && x < i.x + (i.w ?? 0) && x + src.w > i.x && y < i.y + (i.h ?? 0) && y + src.h > i.y)
    for (let k = 0; k < 20 && taken(); k++) {
      if (dx) y += src.h + 40
      else x += src.w + 40
    }
    x = Math.round(x)
    y = Math.round(y)
    const made = await addItem({ kind: src.kind, x, y, w: src.w, h: src.h, text: '', ...(src.color ? { color: src.color } : {}) })
    if (!made) return
    const a = [src.x + src.w / 2 + (dx * src.w) / 2, src.y + src.h / 2 + (dy * src.h) / 2]
    const b = [x + src.w / 2 - (dx * src.w) / 2, y + src.h / 2 - (dy * src.h) / 2]
    const ax = Math.round(Math.min(a[0], b[0]))
    const ay = Math.round(Math.min(a[1], b[1]))
    await addItem({ kind: 'arrow', x: ax, y: ay, w: Math.round(Math.abs(b[0] - a[0])), h: Math.round(Math.abs(b[1] - a[1])), points: [a[0] - ax, a[1] - ay, b[0] - ax, b[1] - ay].map(Math.round), from: src.id, to: made })
    setTool('select')
    renderItems()
    pickItem(made)
    editItemText(made)
  }
  async function newArtboard(x, y, w, hgt) {
    if (data.memory) return hint(NO_FILES, 4000)
    const name = await question('Name the new prototype file. It is made in the canvas folder.', 'untitled')
    if (!name) return
    try {
      const res = await fetch('/api/artboard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, x, y, w, h: hgt, page: pageId, by: me || 'someone' }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Making it failed (${res.status})`)
      // Served by node, the server rebuilds and every page reloads; from disk, the frame is added here.
      if (body.event) {
        boardEvents.push(body.event)
        board = foldPlaced(boardEvents)
        layoutAll()
        renderPage()
        loadVisible()
      }
      hint(`${body.file} made`, 2000)
    } catch (err) {
      hint(err.message, 4000)
    }
  }

  // ── locks ──
  // A locked frame or board object is not moved, changed or removed by anyone until it is
  // unlocked, and a visitor puts nothing new over it. Only the owner locks and unlocks: whoever
  // edits the canvas where it lives (served by node, or its folder on disk), never a visitor to a
  // published copy.
  const LOCKED = 'That is locked'
  const isLocked = (key) => !!key && (board.locked ?? []).includes(key)
  const owner = () => serve && !visitor
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  /** The locked frames and objects on this page a box would sit over, leaving out `self`. */
  function coversLocked(box, self) {
    const lockedFrames = frames().filter((f) => f.key !== self && isLocked(f.key)).map((f) => ({ x: f.x, y: f.y, w: f.W, h: f.H }))
    const lockedItems = items().filter((i) => i.id !== self && isLocked(i.id) && !['line', 'arrow', 'guide'].includes(i.kind)).map(geometryOf)
    return [...lockedFrames, ...lockedItems].some((b) => overlaps(box, { x: b.x, y: b.y, w: b.w ?? 0, h: b.h ?? 0 }))
  }
  /** Why a board change may not be made, or null. */
  function lockedReason(input) {
    if (input.op === 'lock') return owner() ? null : 'Only the owner can lock and unlock things.'
    if ((input.op === 'item' || input.op === 'remove') && isLocked(input.id)) return LOCKED
    if (input.op === 'move' && isLocked(input.key)) return LOCKED
    if (owner()) return null
    if (input.op === 'page' && input.removed) {
      const held = [...allFrames.values()].some((f) => f.page === input.id && isLocked(f.key)) || board.items.some((i) => (i.page ?? firstPage()) === input.id && isLocked(i.id))
      return held ? 'That page holds locked work' : null
    }
    let box = null
    if (input.op === 'move') {
      const f = allFrames.get(input.key)
      if (f) box = { x: input.x, y: input.y, w: f.W, h: f.H }
    } else if (input.op === 'item') {
      const it = { ...(board.items.find((i) => i.id === input.id) ?? {}), ...input }
      if (!['line', 'arrow', 'guide'].includes(it.kind) && it.x != null) box = { x: it.x, y: it.y, w: it.w ?? 200, h: it.h ?? 60 }
      if (box) return coversLocked(box, input.id) ? 'That would cover locked work' : null
      return null
    }
    return box && coversLocked(box, input.key) ? 'That would cover locked work' : null
  }
  /** After a change was refused: draw the board as its lines say again. */
  function takeBoardAgain() {
    board = foldPlaced(boardEvents)
    relayout()
    placeItemBar()
  }
  async function setLock(keys, locked) {
    try {
      for (const key of keys) await sendBoard({ op: 'lock', key, locked })
      hint(locked ? `Locked ${keys.length === 1 ? 'it' : keys.length}` : `Unlocked ${keys.length === 1 ? 'it' : keys.length}`, 1600)
    } catch (err) {
      hint(err.message, 3000)
    }
    renderItems()
    drawLocks()
    placeItemBar()
  }
  /** Each frame's lock in its header: a padlock when locked; for the owner, the button that toggles it. */
  function drawLock(f) {
    if (!f.labelEl) return
    f.actsW = 0
    f.lockEl?.remove()
    const on = isLocked(f.key)
    if (!on && !owner()) return (f.lockEl = null)
    f.lockEl = h('button', {
      type: 'button',
      class: `lock${on ? ' on' : ''}`,
      title: owner() ? (on ? 'Locked: click to unlock' : 'Lock this artboard') : 'Locked by its owner',
      'aria-pressed': String(on),
      disabled: !owner(),
      onclick: (e) => { e.stopPropagation(); setLock([f.key], !on) },
    }, icon(on ? 'lock' : 'unlock'))
    f.labelEl.querySelector('.name')?.after(f.lockEl)
  }
  const drawLocks = () => { for (const f of allFrames.values()) drawLock(f); stackLabels() }

  // Changes drawn before their lines are saved, by 'item:<id>' or 'frame:<key>': each board read from the lines again
  // (as every saved line does) takes them back on until their own line is saved.
  const ahead = new Map()
  function drawAhead() {
    for (const [k, fields] of ahead) {
      if (k.startsWith('item:')) {
        if (fields.removed) board.items = board.items.filter((i) => i.id !== k.slice(5))
        const it = board.items.find((i) => i.id === k.slice(5))
        if (it) Object.assign(it, fields)
      } else {
        const key = k.slice(6)
        const f = allFrames.get(key)
        const m = { ...(board.moved?.[key] ?? (f ? { x: f.x, y: f.y, page: pageId } : {})), ...fields }
        if (fields.group === '') delete m.group
        board.moved = { ...(board.moved ?? {}), [key]: m }
      }
    }
    placeStamps(board)
  }
  /** Every line of one action: all of it drawn at once, then saved in order, so what is drawn never steps back while
   *  the later lines are on their way (a deletion of several, a color, an align, a drag). */
  async function sendAll(inputs) {
    for (const input of inputs) {
      if (input.op === 'remove') ahead.set(`item:${input.id}`, { removed: true })
      else if (input.op === 'item' && input.id) {
        const { op, id, name, ...fields } = input
        ahead.set(`item:${id}`, { ...(ahead.get(`item:${id}`) ?? {}), ...fields })
      } else if (input.op === 'move') {
        const { op, key, name, ...fields } = input
        ahead.set(`frame:${key}`, { ...(ahead.get(`frame:${key}`) ?? {}), ...fields })
      }
    }
    drawAhead()
    for (const input of inputs) await sendBoard(input)
  }
  async function sendBoard(input) {
    if (!serve) throw new Error(readOnly)
    const refused = lockedReason(input)
    if (refused) throw new Error(refused)
    // What the line changes, as the lines said before it: the board as drawn may already show the change.
    const was = replaying ? null : stateOf(foldBoard(boardEvents), input)
    pending++
    try {
      const res = await fetch('/api/board', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: { name: me || 'someone', ...input } }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Saving failed (${res.status})`)
      boardEvents.push(body.event)
      board = foldPlaced(boardEvents)
      if (was) remember(was, stateOf(board, body.event))
      // What is drawn ahead of lines still being saved (the rest of a group) stays drawn; this line's part is saved.
      ahead.delete(body.event.op === 'move' ? `frame:${body.event.key}` : `item:${body.event.id}`)
      drawAhead()
      return body.event
    } catch (err) {
      ahead.clear()
      throw err
    } finally {
      pending--
      // A redraw from the server held back while these were saved comes now.
      if (!pending && boardMissed) {
        boardMissed = false
        setTimeout(refreshBoard, 0)
      }
    }
  }

  // ── find and replace: the page's artboards' text and its board objects' text ──
  const findBar = h('div', { id: 'findbar', role: 'search', 'aria-label': 'Find and replace' })
  document.body.append(findBar)
  let found = []
  let foundAt = -1
  const findIn = h('input', { type: 'search', placeholder: 'Find', 'aria-label': 'Find', spellcheck: 'false' })
  const replaceIn = h('input', { type: 'text', placeholder: 'Replace with', 'aria-label': 'Replace with', spellcheck: 'false' })
  const findCount = h('span', { class: 'find-n', 'aria-live': 'polite' })
  findBar.append(
    findIn, findCount,
    h('button', { type: 'button', class: 'tool', title: 'Previous (Shift+Enter)', 'aria-label': 'Previous', onclick: () => stepFound(-1) }, '↑'),
    h('button', { type: 'button', class: 'tool', title: 'Next (Enter)', 'aria-label': 'Next', onclick: () => stepFound(1) }, '↓'),
    h('span', { class: 'sep' }),
    replaceIn,
    h('button', { type: 'button', class: 'tool', title: 'Replace every match on this page', onclick: () => replaceAll() }, 'Replace all'),
    h('button', { type: 'button', class: 'tool', title: 'Close (Escape)', 'aria-label': 'Close', onclick: () => closeFind() }, '✕'),
  )
  /** Every artboard on the page is loaded, so all of its text can be searched. */
  async function loadPage() {
    for (const f of frames()) if (!f.loaded && f.el) { f.loaded = true; loadFrame(f) }
    for (let i = 0; i < 50 && frames().some((f) => f.el && !f.doc); i++) await new Promise((r) => setTimeout(r, 100))
  }
  async function runFind() {
    const q = findIn.value.trim().toLowerCase()
    found = []
    foundAt = -1
    if (q) {
      await loadPage()
      for (const f of frames()) {
        if (!f.doc?.body) continue
        const walk = f.doc.createTreeWalker(f.doc.body, NodeFilter.SHOW_TEXT, { acceptNode: (t) => (t.parentElement?.closest('script, style, template, noscript') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) })
        for (let t = walk.nextNode(); t; t = walk.nextNode()) {
          const n = t.data.toLowerCase().split(q).length - 1
          const el = call('climb', t.parentElement) ?? t.parentElement
          for (let i = 0; i < n; i++) found.push({ frame: f, el })
        }
      }
      for (const it of items()) {
        const n = String(it.text ?? '').toLowerCase().split(q).length - 1
        for (let i = 0; i < n; i++) found.push({ item: it.id })
      }
    }
    findCount.textContent = q ? (found.length ? `${found.length} found` : 'None') : ''
  }
  function stepFound(d) {
    if (!found.length) return
    foundAt = (foundAt + d + found.length) % found.length
    const m = found[foundAt]
    findCount.textContent = `${foundAt + 1} of ${found.length}`
    if (m.item) {
      pickItem(m.item)
      zoomToSelection()
    } else if (m.el?.isConnected) {
      pickItem(null)
      window.designCanvas.editor?.select(m.frame, [m.el])
      zoomToSelection()
    }
  }
  async function replaceAll() {
    const find = findIn.value.trim()
    if (!find || !serve) return
    const put = replaceIn.value
    const files = [...new Set(found.filter((m) => m.frame).map((m) => m.frame.file))]
    let n = 0
    // Every screen and every board object it reaches is one step: one Ctrl+Z takes the whole replacing back.
    let fileStep = null
    try {
      if (files.length) {
        const res = await fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files, edit: { op: 'replaceText', find, with: put }, name: me || 'someone' }) })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || `Replacing failed (${res.status})`)
        if (!body.same) {
          n += body.count ?? 0
          noteFileEdit()
          fileStep = history.at(-1)
          for (const [file, html] of Object.entries(body.files ?? {})) reloadFile(file, html)
        }
      }
      openStep = null
      const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      for (const id of [...new Set(found.filter((m) => m.item).map((m) => m.item))]) {
        const it = board.items.find((i) => i.id === id)
        if (!it || isLocked(id)) continue
        const text = String(it.text ?? '').replace(re, (m) => (n++, typeof canvasHtml === 'undefined' ? put : canvasHtml.inCaseOf(m, put)))
        it.text = text
        await sendBoard({ op: 'item', id, text })
      }
      // The notes' step rides on the screens' one.
      const last = history.at(-1)
      if (fileStep && last !== fileStep && last?.kind === 'board') {
        history.pop()
        if (openStep === last) openStep = null
        fileStep.board = last
      }
      renderItems()
      hint(n ? `Replaced ${n}` : 'Nothing replaced', 1600)
    } catch (err) {
      hint(err.message, 3000)
    }
    setTimeout(runFind, 400)
  }
  let findTimer = 0
  findIn.addEventListener('input', () => {
    clearTimeout(findTimer)
    findTimer = setTimeout(runFind, 150)
  })
  for (const input of [findIn, replaceIn]) {
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') closeFind()
      else if (e.key === 'Enter' && input === findIn) stepFound(e.shiftKey ? -1 : 1)
      else if (e.key === 'Enter') replaceAll()
    })
  }
  function openFind() {
    findBar.classList.add('open')
    replaceIn.parentElement && (replaceIn.disabled = !serve)
    findIn.focus()
    findIn.select()
    if (findIn.value) runFind()
  }
  function closeFind() {
    findBar.classList.remove('open')
    found = []
  }

  // ── undo and redo for the board ──
  // One history with the prototypes' edits, as in Figma: Ctrl+Z undoes whatever was done last.
  // A step is everything one action sent (a group dragged, an align, a paste): each board object
  // and frame it touched, as it was before and after. A file edit is a 'file' entry, undone by the server.
  const history = []
  const future = []
  let openStep = null
  let replaying = false
  const ITEM_KEYS = ['kind', 'page', 'x', 'y', 'w', 'h', 'z', 'text', 'color', 'frame', 'from', 'to', 'group', 'cols', 'gutter', 'margin', 'points', 'size', 'src', 'route', 'dx', 'dy', 'weight', 'pen', 'ends', 'dash', 'fill', 'author', 'vote']
  /** A board object's words with each web address in them a link, as FigJam's: Ctrl or Cmd + click opens it (a plain
      click picks the object, as anywhere on it), and where nothing can be edited a plain click opens it. */
  function linked(text) {
    const parts = String(text ?? '').split(/(https?:\/\/[^\s<>"]+)/)
    return parts.map((t, i) => {
      if (i % 2 === 0) return t
      const tail = /[.,;:!?)\]]+$/.exec(t)?.[0] ?? ''
      const href = tail ? t.slice(0, -tail.length) : t
      return [h('a', { class: 'board-link', href, target: '_blank', rel: 'noopener', title: serve ? `${href} (Ctrl+click to open)` : href }, href), tail]
    }).flat().filter((x) => x !== '')
  }
  viewport.addEventListener('click', (e) => {
    const a = e.target.closest?.('a.board-link')
    if (!a || a.closest('[contenteditable="true"], [contenteditable="plaintext-only"]')) return
    // Opened on the press (above), never by the browser following it on the click.
    e.preventDefault()
  })
  /** The one thing a line touches, as a board says it is: an object's fields, a frame's place, or null for nothing there. */
  function stateOf(b, ev) {
    if (ev.op === 'item' || ev.op === 'remove') {
      if (!ev.id) return { id: null, state: null }
      const it = b.items.find((i) => i.id === ev.id)
      return { id: ev.id, state: it ? Object.fromEntries(ITEM_KEYS.filter((k) => it[k] != null).map((k) => [k, it[k]])) : null }
    }
    if (ev.op === 'move') {
      const f = allFrames.get(ev.key)
      const m = b.moved[ev.key] ?? f?.home
      return { key: ev.key, state: m ? { x: m.x, y: m.y, page: m.page ?? f?.page ?? null, group: m.group ?? '' } : null }
    }
    // A page: its name and whether it is removed; a new page's id is known from its line.
    if (ev.op === 'page') {
      // A page the layout made has no line until it is first changed: its name is the layout's.
      const own = ev.id ? b.pages.find((x) => x.id === ev.id) : null
      const laid = ev.id ? data.pages.find((x) => x.id === ev.id) : null
      const at = ev.order != null ? pages().findIndex((x) => x.id === ev.id) : -1
      const p = own || laid ? { title: own?.title || laid?.title, removed: !!own?.removed, ...(ev.order != null ? { order: own?.order ?? at } : {}) } : null
      return { kind: 'page', id: ev.id ?? null, state: p }
    }
    if (ev.op === 'lock') return { kind: 'lock', key: ev.key, state: b.locked.includes(ev.key) }
    if (ev.op === 'name') return { kind: 'name', key: 'canvas', state: b.name || data.title }
    return null
  }
  function remember(before, after) {
    // A new object's id is only known from its line.
    if (before.id === null) before.id = after.id
    if (!openStep) {
      // What was selected as the step began comes back with it on undo and redo, as in Figma.
      openStep = { kind: 'board', changes: new Map(), selection: { items: chosen ? [...chosen.items] : picked ? withGroup(picked) : [], frames: chosen ? [...chosen.frames] : [] } }
      history.push(openStep)
      future.length = 0
      if (history.length > 200) history.shift()
      const step = openStep
      // The step closes once its action has sent everything: each send starts as the last one ends, before any timer.
      const close = () => (pending ? setTimeout(close, 0) : openStep === step && (openStep = null))
      setTimeout(close, 0)
    }
    const k = before.kind ? `${before.kind}:${before.id ?? before.key}` : before.id ?? `frame:${before.key}`
    const c = openStep.changes.get(k)
    if (c) c.after = after.state
    else openStep.changes.set(k, { kind: before.kind, id: before.id, key: before.key, before: before.state, after: after.state })
  }
  let pending = 0
  let boardMissed = false
  /** Put every object and frame of a step back as it was (or forward as it became). */
  async function replay(step, back) {
    replaying = true
    try {
      for (const c of [...step.changes.values()].reverse()) {
        const want = back ? c.before : c.after
        const other = back ? c.after : c.before
        if (c.kind === 'page') {
          await sendBoard(want ? { op: 'page', id: c.id, title: want.title, removed: want.removed, ...(want.order != null ? { order: want.order } : {}) } : { op: 'page', id: c.id, removed: true })
          continue
        }
        if (c.kind === 'name') {
          await sendBoard({ op: 'name', title: want })
          setTitle(want)
          continue
        }
        if (c.kind === 'lock') {
          await sendBoard({ op: 'lock', key: c.key, locked: want })
          continue
        }
        if (c.key) {
          if (want) await sendBoard({ op: 'move', key: c.key, x: want.x, y: want.y, ...(want.page ? { page: want.page } : {}), ...(want.group != null ? { group: want.group } : {}) })
          continue
        }
        if (!want) {
          if (board.items.some((i) => i.id === c.id)) await sendBoard({ op: 'remove', id: c.id })
          continue
        }
        // A field the other side had and this one lacks is cleared.
        const clear = Object.fromEntries(Object.keys(other ?? {}).filter((k) => want[k] == null).map((k) => [k, ['x', 'y', 'w', 'h', 'z'].includes(k) ? 0 : k === 'points' ? [] : '']))
        await sendBoard({ op: 'item', id: c.id, ...clear, ...want })
      }
    } finally {
      replaying = false
      relayout()
      // A page put back or taken away: the switcher and, if it was this page, the page shown.
      if (!pages().some((p) => p.id === pageId)) goPage(firstPage())
      else renderPage()
      pickItem(null)
      renderItems()
    }
  }
  /** Ctrl+Z or Ctrl+Shift+Z: true when the last thing done was on the board and it was undone here. */
  async function boardUndo(redo) {
    const from = redo ? future : history
    const to = redo ? history : future
    const top = from[from.length - 1]
    if (!top) return false
    from.pop()
    to.push(top)
    if (top === openStep) openStep = null
    // A prototype edit that changed board objects too (Replace all): those go back here, the files by the server.
    if (top.kind === 'file') {
      if (top.board) {
        try { await replay(top.board, !redo) } catch (err) { hint(err.message, 3000) }
      }
      return false
    }
    try {
      await replay(top, !redo)
      hint(redo ? 'Redone' : 'Undone', 900)
      // The selection comes back as it was when the step was made, as Figma's undo does, so it shows what came back:
      // what of it is on this page after the step; else what the step changed that is still there; else nothing.
      const here = (id) => board.items.some((i) => i.id === id && (i.page ?? firstPage()) === pageId && i.kind !== 'guide')
      const onPage = (k) => frames().some((f) => f.key === k)
      let ids = (top.selection?.items ?? []).filter(here)
      let keys = (top.selection?.frames ?? []).filter(onPage)
      if (!ids.length && !keys.length) {
        const kept = [...top.changes.values()].filter((c) => !['page', 'name', 'lock'].includes(c.kind) && (redo ? c.after : c.before))
        ids = kept.filter((c) => !c.key && here(c.id)).map((c) => c.id)
        keys = kept.filter((c) => c.key && onPage(c.key)).map((c) => c.key)
      }
      if (ids.length || keys.length) chooseItems([...new Set(ids)], [...new Set(keys)])
      else pickItem(null)
    } catch (err) {
      hint(err.message, 3000)
      takeBoardAgain()
    }
    return true
  }
  /** A prototype edit was made: it takes its place in the one history. */
  const noteFileEdit = () => {
    openStep = null
    history.push({ kind: 'file' })
    future.length = 0
  }

  // ── comments ──
  // Where comments go: served by node, the server; otherwise the address the canvas was built with
  // (`comments` in canvas.json, or --comments), or the hosting site's own endpoint, as team docs has.
  // Editing from disk switches it to the page's own answers (local.js).
  let api = serve ? '/api/canvas-comments' : data.comments || (web ? '/api/canvas-comments' : null)
  const crossSite = () => /^https?:/.test(api) && new URL(api).origin !== location.origin
  const withCredentials = () => (crossSite() ? { credentials: 'include', mode: 'cors' } : {})
  const readOnly = 'This was opened from disk, so it\'s view-only for now. To edit, click Edit here (in Chrome or Edge) and allow its folder.'
  let events = []
  let threads = []
  let commentDraft = null
  let draft = null
  let activeId = null
  let me = store.get('name') || ''
  let viewer = null
  const showResolved = () => $('#show-resolved').checked

  /** Where a thread's pin is on the board: on its element when the editor can find it, else where it was left. */
  const anchorOf = (t) => {
    const f = t.frame ? findFrame(t.frame) : null
    if (t.anchor && f && f.page === pageId) {
      const at = call('anchorPoint', t, f)
      if (at) return { x: at.x, y: at.y, top: at.top, bottom: at.bottom, frame: f, page: f.page }
      return { x: f.x + t.x * (f.s ?? 1), y: f.y + t.y * (f.s ?? 1), frame: f, page: f.page, detached: !!f.doc }
    }
    if (f) return { x: f.x + t.x * (f.s ?? 1), y: f.y + t.y * (f.s ?? 1), frame: f, page: f.page }
    // On a board object: where the object is now, at the same offset; else where it was left, on its own page.
    const on = t.item ? board.items.find((i) => i.id === t.item) : null
    if (on) return { x: on.x + (t.dx ?? 0), y: on.y + (t.dy ?? 0), frame: null, page: on.page ?? firstPage() }
    return { x: t.x, y: t.y, frame: null, page: t.page ?? firstPage() }
  }
  const number = (t) => threads.indexOf(t) + 1 || '…'
  /** Everyone who has written a comment or reply here, for @mentions. */
  const people = () => [...new Set(threads.flatMap((t) => [t.name, ...t.replies.map((r) => r.name)]).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  /** A message's words, each @Name of someone here shown as a mention and each web address as a link. */
  const webLinks = (text) => String(text).split(/(https?:\/\/[^\s<>"]+)/).flatMap((t, i) => {
    if (i % 2 === 0) return t ? [t] : []
    const tail = /[.,;:!?)\]]+$/.exec(t)?.[0] ?? ''
    const href = tail ? t.slice(0, -tail.length) : t
    return [h('a', { class: 'msg-link', href, target: '_blank', rel: 'noopener' }, href), ...(tail ? [tail] : [])]
  })
  const withMentions = (text) => {
    const names = people().sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    if (!names.length) return webLinks(text)
    return text.split(new RegExp(`(@(?:${names.join('|')}))(?![\\w])`)).flatMap((part, i) => (i % 2 ? [h('b', { class: 'mention' }, part)] : webLinks(part)))
  }
  const when = (iso) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  /** The pins on board objects, put where their objects now are: only those, while objects are dragged or redrawn. */
  function movePinsOnItems() {
    for (const p of pinLayer.querySelectorAll('.pin[data-thread]')) {
      const t = threads.find((x) => x.id === p.dataset.thread)
      if (!t?.item) continue
      const a = anchorOf(t)
      p.style.left = `${a.x}px`
      p.style.top = `${a.y}px`
    }
    placeThread()
  }
  // Figma's unread comments: a thread with a message someone else wrote since this browser last opened it shows a dot
  // on its pin and in the Comments list; opening it marks it read. Kept in this browser.
  const seenAt = () => store.get('seen') ?? {}
  const unread = (t) => !t.resolved && [t, ...t.replies].some((m) => m.name !== me && (Date.parse(m.at) || 0) > (seenAt()[t.id] ?? 0))
  const markSeen = (t) => {
    const seen = seenAt()
    seen[t.id] = Math.max(Date.now(), ...[t, ...t.replies].map((m) => Date.parse(m.at) || 0))
    store.set('seen', seen)
  }
  function renderPins() {
    showEmpty()
    drawFlows()
    itemPins = threads.some((t) => t.item)
    pinLayer.replaceChildren()
    for (const t of threads) {
      const p = anchorOf(t)
      if (p.page !== pageId) continue
      pinLayer.append(h('button', {
        type: 'button',
        class: `pin${t.resolved ? ' resolved' : ''}${t.agent ? ' agent' : ''}${t.id === activeId ? ' active' : ''}${p.detached ? ' detached' : ''}${t.id !== activeId && unread(t) ? ' unread' : ''}`,
        'data-thread': t.id,
        style: `left:${p.x}px;top:${p.y}px`,
        title: `${t.name}: ${t.text}${p.detached ? ' (its element is gone; pinned where it was left)' : ''}`,
        onpointerdown: (e) => pinPress(e, t),
        // The click that ends a drag does not open the thread.
        onclick: (e) => { e.stopPropagation(); if (e.currentTarget.dataset.dragged) delete e.currentTarget.dataset.dragged; else openThread(t.id) },
      }, String(number(t))))
    }
    if (draft) pinLayer.append(h('div', { class: 'pin active', style: `left:${draft.wx}px;top:${draft.wy}px` }, '+'))
    const open = threads.filter((t) => !t.resolved).length
    $('#comment-count').textContent = String(open)
    $('#comment-count').hidden = !open
    renderList()
    renderPlayPins()
  }
  function renderList() {
    const list = $('#comment-list')
    document.body.classList.toggle('hide-resolved', !showResolved())
    // Figma's comment filters: words looked for in a thread and its replies, only the threads the viewer started,
    // answered or is named in, and the order, as numbered or with the latest said first.
    const q = ($('#comment-search')?.value ?? '').trim().toLowerCase()
    const mine = $('#only-mine')?.checked && me
    const said = (t) => [t, ...t.replies]
    const latest = (t) => Math.max(...said(t).map((m) => Date.parse(m.at) || 0))
    const shown = threads
      .filter((t) => showResolved() || !t.resolved)
      .filter((t) => !q || said(t).some((m) => String(m.text ?? '').toLowerCase().includes(q) || String(m.name ?? '').toLowerCase().includes(q)))
      .filter((t) => !mine || said(t).some((m) => m.name === me || String(m.text ?? '').includes(`@${me}`)))
    if ($('#comment-sort')?.value === 'recent') shown.sort((a, b) => latest(b) - latest(a))
    $('#mark-read').hidden = !threads.some(unread)
    list.replaceChildren(...(shown.length
      ? shown.map((t) => {
          const f = t.frame ? findFrame(t.frame) : null
          return h('button', { type: 'button', class: `citem${t.resolved ? ' resolved' : ''}${t.agent ? ' agent' : ''}${t.id === activeId ? ' active' : ''}${t.id !== activeId && unread(t) ? ' unread' : ''}`, 'aria-label': unread(t) && t.id !== activeId ? `Unread: ${t.name}: ${t.text}` : null, onclick: () => openThread(t.id, true) },
            h('div', { class: 'meta' }, h('span', { class: 'num' }, String(number(t))), h('b', {}, t.name), h('span', {}, when(t.at)), t.agent ? h('span', {}, '· for the agent') : null, t.replies.length ? h('span', {}, `· ${t.replies.length} repl${t.replies.length === 1 ? 'y' : 'ies'}`) : null, t.resolved ? h('span', {}, '· resolved') : null),
            h('div', { class: 'body' }, t.text),
            h('div', { class: 'where' }, f ? `${pages().find((p) => p.id === f.page)?.title ?? ''} · ${f.label}` : 'On the board'))
        })
      : [h('div', { class: 'empty' }, q || mine ? 'No comment matches.' : api ? 'No comments yet. Press C, then click anywhere.' : 'No comments.')]))
  }

  /** Where a comment left at this point on the screen is: on a screen (and its element), on a board object, or on the
   *  board itself. */
  function commentPlace(sx, sy) {
    const p = toWorld(sx, sy)
    const f = frameAt(sx, sy)
    const pin = f ? call('commentAnchor', f, p) : null
    // Dropped on a board object (a note, a shape, a section): the pin goes with it when it moves.
    const on = f ? null : board.items.find((i) => i.id === document.elementFromPoint(sx, sy)?.closest('.item')?.dataset.id && i.kind !== 'line' && i.kind !== 'arrow' && i.kind !== 'pencil')
    return { wx: p.x, wy: p.y, frame: f ? f.key : null, x: f ? Math.round((p.x - f.x) / f.s) : Math.round(p.x), y: f ? Math.round((p.y - f.y) / f.s) : Math.round(p.y), page: pageId, ...(on ? { item: on.id, dx: Math.round(p.x - on.x), dy: Math.round(p.y - on.y) } : {}), ...(pin ?? {}) }
  }
  /** Figma's comment drag: whoever wrote a thread drags its pin somewhere else; a press without a drag opens it. */
  function pinPress(e, t) {
    if (e.button !== 0) return
    const pin = e.currentTarget
    const mine = api && me && t.name === me
    const sx = e.clientX
    const sy = e.clientY
    let moved = false
    const move = (ev) => {
      if (!mine) return
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return
      moved = true
      pin.classList.add('dragging')
      const p = toWorld(ev.clientX, ev.clientY)
      pin.style.left = `${p.x}px`
      pin.style.top = `${p.y}px`
    }
    const up = async (ev) => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      if (!moved) return
      pin.dataset.dragged = '1'
      setTimeout(() => delete pin.dataset.dragged, 0)
      const place = commentPlace(ev.clientX, ev.clientY)
      pin.classList.remove('dragging')
      try {
        const { wx, wy, ...at } = place
        await send({ op: 'place', to: t.id, name: me, ...at })
      } catch (err) { hint(err.message, 3000) }
      renderPins()
      if (activeId === t.id) showThread({ id: t.id }, true)
    }
    e.stopPropagation()
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }
  function startComment(sx, sy, agent = false) {
    if (!api) return hint(readOnly, 3000)
    draft = { ...commentPlace(sx, sy), agent }
    activeId = null
    renderPins()
    showThread({ draft })
  }
  /** A comment on whatever the editor has selected: pinned to it, at its top-left corner. */
  function commentOn(target, agent = false) {
    if (!api) return hint(readOnly, 3000)
    const f = target.frame
    draft = { wx: target.wx, wy: target.wy, frame: f.key, x: Math.round((target.wx - f.x) / f.s), y: Math.round((target.wy - f.y) / f.s), page: f.page, agent, file: target.file, anchor: target.anchor }
    activeId = null
    renderPins()
    showThread({ draft })
  }

  async function send(input) {
    const res = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: location.pathname, event: input }), ...withCredentials() })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `Saving failed (${res.status})`)
    events.push(body.event)
    threads = foldEvents(events)
    return body.event
  }
  async function refresh() {
    if (!api) return
    try {
      const res = await fetch(`${api}${api.includes('?') ? '&' : '?'}path=${encodeURIComponent(location.pathname)}`, { cache: 'no-store', ...withCredentials() })
      if (!res.ok) return
      const body = await res.json()
      viewer = body.viewer ?? null
      if (!me && viewer?.name) setName(viewer.name)
      // Only when something changed: redrawing an open thread on every poll would take the focus
      // and the caret out of a reply being typed.
      if (Array.isArray(body.events) && body.events.length >= events.length && JSON.stringify(body.events) !== JSON.stringify(events)) {
        events = body.events
        threads = foldEvents(events)
        renderPins()
        if (linkedComment && threads.some((t) => t.id === linkedComment)) goCommentFromHash()
        else if (activeId) {
          if (threads.some((t) => t.id === activeId)) showThread({ id: activeId }, true)
          else closeThread()
        }
      }
    } catch {}
  }
  function setName(name) {
    me = name.trim().slice(0, LIMITS.name)
    store.set('name', me)
    $('#my-name').value = me
    roomSend({ t: 'name', name: me || 'Someone' })
  }

  // ── who else is here, as Figma's multiplayer: each person's pointer on the board, with their name, and their faces
  // in the top bar; a face clicked goes to where they are. The room is the address in canvas.json's "room" (a hosted
  // room, worker/room.js) when it has one; else, served, the server's own (/api/room). ──
  // var, not const: the view is drawn (apply, which places the pointers) before this part of the script has run.
  var peers = new Map()
  var peerLayer = h('div', { id: 'peer-layer', 'aria-hidden': 'true' })
  document.body.append(peerLayer)
  const peerBar = h('div', { id: 'peers', role: 'list', 'aria-label': 'Who else is here' })
  $('#bar-right').prepend(peerBar)
  let roomSocket = null
  let helloName = ''
  let roomId = ''
  let roomTries = 0
  let lastSent = 0
  let cursorTimer = 0
  let pendingCursor = null
  const roomUrl = () => data.room || (data.serve && web && !local ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/room` : null)
  function joinRoom() {
    // The server's own browser taking a picture of the board is nobody to the others here.
    if (/[?&]dc-shot\b/.test(location.search)) return
    const url = roomUrl()
    if (!url || typeof WebSocket === 'undefined') return
    const ws = new WebSocket(url)
    roomSocket = ws
    ws.onopen = () => {
      roomTries = 0
      helloName = me || 'Someone'
      ws.send(JSON.stringify({ t: 'hello', name: helloName, ...(invite ? { key: invite } : {}) }))
    }
    ws.onmessage = (e) => {
      let m
      try { m = JSON.parse(e.data) } catch { return }
      onRoom(m)
    }
    ws.onclose = () => {
      if (roomSocket !== ws) return
      roomSocket = null
      peers.clear()
      drawPeers()
      // Back again when it can be: soon, then less often.
      setTimeout(joinRoom, Math.min(30000, 1000 * 2 ** roomTries++))
    }
  }
  function onRoom(m) {
    if (m.t === 'welcome' || m.t === 'host') hostSays(m)
    if (m.t === 'answer') return answered(m)
    if (m.t === 'tell') return told(m)
    if (m.t === 'welcome') {
      roomId = m.id
      // A name set while the room was still connecting was not sent: send it now; so too where this pointer is and
      // what is selected, for anyone here or coming in.
      if ((me || 'Someone') !== helloName) roomSend({ t: 'name', name: me || 'Someone' })
      if (pendingCursor) roomSend({ t: 'cursor', ...pendingCursor })
      selSent = ''
      peers.clear()
      for (const p of m.peers ?? []) peers.set(p.id, p)
      if (m.timer) setTimer(m.timer.left, m.timer.by)
      // Someone was spotlighting when this person came in: follow them too.
      const lit = (m.peers ?? []).find((p) => p.spotlight)
      if (lit) setTimeout(() => startFollow(lit.id), 0)
    } else if (m.t === 'join') {
      peers.set(m.id, m)
      sendView(true)
      selSent = ''
    } else if (m.t === 'leave') {
      peers.delete(m.id)
      if (following === m.id) stopFollow()
    } else if (m.t === 'timer') {
      return setTimer(m.left, m.by)
    } else if (m.t === 'spotlight' && peers.has(m.id)) {
      if (m.on) {
        startFollow(m.id)
        hint(`${peers.get(m.id).name} asked everyone to follow them. Stop, or move the board, to look around yourself.`, 4000)
      } else if (following === m.id) stopFollow()
      return
    } else if (m.t === 'chat' && peers.has(m.id)) {
      peers.get(m.id).chat = m.text
      const el = peerLayer.querySelector(`.peer-cursor[data-peer="${m.id}"] .peer-chat`)
      if (el) {
        el.textContent = m.text
        el.hidden = !m.text
      }
      return
    } else if (m.t === 'sel' && peers.has(m.id)) {
      peers.get(m.id).sel = m.page ? { page: m.page, boxes: m.boxes } : null
      drawPeerSel()
      return
    } else if (m.t === 'view' && peers.has(m.id)) {
      peers.get(m.id).view = m
      if (following === m.id) followTo(m)
      return
    }
    else if (m.t === 'name' && peers.has(m.id)) peers.get(m.id).name = m.name
    else if (m.t === 'cursor' && peers.has(m.id)) {
      peers.get(m.id).cursor = m.page ? { page: m.page, x: m.x, y: m.y } : null
      return placePeers()
    } else return
    drawPeers()
  }
  const roomSend = (m) => { if (roomSocket?.readyState === 1) roomSocket.send(JSON.stringify(m)) }
  // At most twenty a second: enough to look smooth, few enough to stay well inside a free host's limits.
  function sendCursor(c) {
    pendingCursor = c
    if (cursorTimer) return
    cursorTimer = setTimeout(() => {
      cursorTimer = 0
      lastSent = Date.now()
      roomSend({ t: 'cursor', ...(pendingCursor ?? { page: null }) })
    }, Math.max(0, 50 - (Date.now() - lastSent)))
  }
  viewport.addEventListener('pointermove', (e) => {
    if (!roomSocket || e.pointerType === 'touch') return
    const p = toWorld(e.clientX, e.clientY)
    sendCursor({ page: pageId, x: p.x, y: p.y })
  })
  viewport.addEventListener('pointerleave', () => { if (roomSocket) sendCursor(null) })
  // The first letter or digit of the first two words that have one: "Check (Chromium)" is CC, not C(.
  const initials = (n) => String(n || '').split(/\s+/).map((w) => w.match(/[\p{L}\p{N}]/u)?.[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'
  function drawPeers() {
    const list = [...peers.values()]
    const shown = list.slice(0, 5)
    peerBar.replaceChildren(...shown.map((p) => h('button', { type: 'button', class: 'peer', role: 'listitem', style: `--c:${p.color}`, title: following === p.id ? `Following ${p.name}: click to stop` : `Follow ${p.name}: see what they see`, 'aria-label': p.name, 'aria-pressed': String(following === p.id), onclick: () => (following === p.id ? stopFollow() : startFollow(p.id)) }, initials(p.name))),
      ...(list.length > shown.length ? [h('span', { class: 'peer more', title: list.slice(5).map((p) => p.name).join(', ') }, `+${list.length - shown.length}`)] : []))
    for (const el of [...peerLayer.children]) if (!peers.has(el.dataset.peer)) el.remove()
    for (const p of list) {
      let el = peerLayer.querySelector(`[data-peer="${p.id}"]`)
      if (!el) {
        el = h('div', { class: 'peer-cursor', 'data-peer': p.id, style: `--c:${p.color}` }, h('span', { class: 'peer-name' }), h('span', { class: 'peer-chat', hidden: !p.chat }, p.chat ?? ''))
        el.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 16 20" width="16" height="20"><path d="M1 1 L1 16 L5 12.5 L8 19 L10.5 18 L7.6 11.6 L13 11.6 Z" style="fill: var(--c)" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>')
        peerLayer.append(el)
      }
      el.querySelector('.peer-name').textContent = p.name
    }
    drawPeerSel()
  }
  // Others' selections: a box in their color round each thing they have selected, on this page.
  function drawPeerSel() {
    if (!peerLayer) return
    for (const el of [...peerLayer.querySelectorAll('.peer-sel')]) el.remove()
    for (const p of peers.values()) {
      for (const b of p.sel?.boxes ?? []) peerLayer.prepend(h('div', { class: 'peer-sel', 'data-sel': p.id, style: `--c:${p.color}`, 'data-box': JSON.stringify(b), 'data-page': p.sel.page }))
    }
    placePeers()
  }
  function placePeers() {
    if (!peerLayer) return
    for (const el of peerLayer.querySelectorAll('.peer-sel')) {
      const b = JSON.parse(el.dataset.box)
      el.hidden = el.dataset.page !== pageId
      if (el.hidden) continue
      const s = toScreen(b.x, b.y)
      Object.assign(el.style, { transform: `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`, width: `${Math.round(b.w * view.z)}px`, height: `${Math.round(b.h * view.z)}px` })
    }
    for (const el of peerLayer.querySelectorAll('.peer-cursor')) {
      const c = peers.get(el.dataset.peer)?.cursor
      const on = !!c && c.page === pageId
      el.hidden = !on
      if (!on) continue
      const s = toScreen(c.x, c.y)
      el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`
    }
  }
  // ── editing through the room: opened with the owner's invite key (#invite=…), while the owner's canvas is in the
  // room, every /api/ call this page makes goes through the room to the owner's server, which answers it as it
  // answers its own page; its news (a file changed, new lines, the board) comes back the same way. The key is taken
  // out of the address once read, so a link copied from here does not pass it on; it is kept for this tab. ──
  var invite = (() => {
    try {
      const m = /(?:^#|&)invite=([^&]+)/.exec(location.hash)
      if (!m) return sessionStorage.getItem('dc-invite') || ''
      const key = decodeURIComponent(m[1])
      sessionStorage.setItem('dc-invite', key)
      const rest = location.hash.replace(/(^#|&)invite=[^&]*/, '$1').replace(/^#&/, '#')
      // window.history: `history` in this script is the canvas's own undo history.
      window.history.replaceState(null, '', `${location.pathname}${location.search}${rest === '#' ? '' : rest}`)
      return key
    } catch { return '' }
  })()
  let remote = false
  let ownerHere = false
  let callN = 0
  const calls = new Map()
  function hostSays(m) {
    if (!invite) return
    if (m.edit && !remote) startRemote()
    if (remote) {
      const was = ownerHere
      ownerHere = !!(m.on ?? m.host)
      showRemote()
      // The owner's canvas back after being away: what its files and board say now, over what this page last had.
      if (ownerHere && !was) catchUp()
    } else if (m.host === false || m.on === false) hint("The owner's canvas isn't open right now. You can look around, and edit once it is.", 4000)
  }
  function showRemote() {
    $('#canvas-mode').textContent = ownerHere ? 'Editing live' : 'Owner offline'
    $('#canvas-mode').title = ownerHere ? "Your changes go straight into the owner's files, and theirs show here." : "The owner's canvas isn't open right now, so changes can't be saved until it is."
  }
  function startRemote() {
    remote = true
    const before = window.fetch
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url
      const path = url.startsWith(location.origin) ? url.slice(location.origin.length) : url
      return remote && /^\/api\//.test(path) ? roomCall(init.method || 'GET', path, init.body) : before(input, init)
    }
    serve = true
    api = '/api/canvas-comments'
    document.body.classList.add('serving', 'commenting')
    ownerHere = true
    catchUp()
  }
  /** What the owner's files, board and comments say now, over what this page has. */
  function catchUp() {
    for (const file of Object.keys(data.files)) fileChanged(file, { quiet: true })
    refreshBoard()
    refresh()
  }
  function roomCall(method, path, body) {
    return new Promise((resolve) => {
      const n = ++callN
      // A picture or a PDF comes as base64 with its type: made into bytes again here.
      const done = (status, text, type) => {
        clearTimeout(c.timer)
        calls.delete(n)
        const bytes = type ? Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0)) : null
        resolve(new Response(bytes ?? text, { status, headers: { 'content-type': type || 'application/json' } }))
      }
      // A picture takes the owner's browser a while to make.
      const c = { parts: [], done, timer: setTimeout(() => done(504, JSON.stringify({ error: "The owner's canvas didn't answer in time." })), /png|pdf/.test(path) ? 90000 : 30000) }
      calls.set(n, c)
      if (roomSocket?.readyState !== 1) return done(503, JSON.stringify({ error: 'Not connected to the room right now. Trying again.' }))
      roomSocket.send(JSON.stringify({ t: 'call', n, method, path, body: typeof body === 'string' ? body : null }))
    })
  }
  function answered(m) {
    const c = calls.get(m.n)
    if (!c) return
    c.parts[m.part ?? 0] = m.body ?? ''
    const of = m.of ?? 1
    if (m.type) c.type = m.type
    if (c.parts.filter((x) => x != null).length === of) c.done(m.status, c.parts.join(''), c.type)
  }
  function told(m) {
    if (!remote) return
    const d = m.data ?? {}
    if (m.event === 'file' && d.file) { if (d.by !== `room-${roomId}`) fileChanged(d.file, { quiet: true }) }
    else if (m.event === 'lines') refresh()
    else if (m.event === 'board') refreshBoard()
    else if (m.event === 'sheet' && d.sheet) reloadSheet(d.sheet, d.text)
  }
  /** Other people's pointers (and their cursor chat) hidden or shown, kept in this browser; faces and selections stay. */
  function setPointersShown(on) {
    document.body.classList.toggle('pointers-off', !on)
    store.set('pointers-off', !on)
    hint(on ? "Others' pointers shown" : "Others' pointers hidden. Ctrl+Alt+\\ shows them again.", 1600)
  }
  if (store.get('pointers-off')) document.body.classList.add('pointers-off')
  // FigJam's timer: set from the canvas menu for everyone in the room (or alone without one); each page counts down
  // what the room says is left, in the top bar; a click on it stops it for everyone.
  let timerEnd = 0
  let timerBy = ''
  let timerDone = 0
  const timerChip = h('button', { type: 'button', id: 'timer-chip', hidden: true, onclick: () => startTimer(0) })
  peerBar.after(timerChip)
  function startTimer(ms) {
    if (roomSocket?.readyState === 1) roomSend({ t: 'timer', ms })
    else setTimer(ms, me || '')
  }
  function setTimer(left, by) {
    timerEnd = left > 0 ? Date.now() + left : 0
    timerBy = by || ''
    clearTimeout(timerDone)
    timerChip.classList.remove('done')
    tickTimer()
    if (!left && by) hint(`${by} stopped the timer.`, 1600)
  }
  function tickTimer() {
    if (!timerEnd) return (timerChip.hidden = !timerChip.classList.contains('done'))
    const left = Math.max(0, timerEnd - Date.now())
    const secs = Math.ceil(left / 1000)
    timerChip.hidden = false
    timerChip.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
    timerChip.title = `Timer${timerBy ? ` set by ${timerBy}` : ''}: click to stop it for everyone`
    if (left > 0) return
    timerEnd = 0
    timerChip.textContent = "Time's up"
    timerChip.classList.add('done')
    timerDone = setTimeout(() => { timerChip.classList.remove('done'); timerChip.hidden = true }, 6000)
  }
  setInterval(tickTimer, 250)
  // Cursor chat: a field at this pointer that follows it; what is typed goes out as it is typed. Enter leaves the words
  // up for four seconds, Escape takes them away at once.
  let chatBox = null
  let chatTimer = 0
  let chatClear = 0
  function openChat() {
    if (chatBox) return chatBox.querySelector('input').focus()
    clearTimeout(chatClear)
    const input = h('input', { type: 'text', maxlength: '100', placeholder: 'Say something', 'aria-label': 'Cursor chat' })
    chatBox = h('div', { class: 'my-chat' }, input)
    document.body.append(chatBox)
    const at = lastPoint ?? { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }
    placeChat(at.x, at.y)
    const send = () => roomSend({ t: 'chat', text: input.value })
    input.addEventListener('input', () => { clearTimeout(chatTimer); chatTimer = setTimeout(send, 80) })
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') closeChat(true)
      else if (e.key === 'Enter') closeChat(!input.value.trim())
    })
    input.addEventListener('blur', () => closeChat(!input.value.trim()))
    input.focus()
  }
  function placeChat(x, y) {
    if (chatBox) chatBox.style.transform = `translate(${Math.round(x) + 14}px, ${Math.round(y) + 18}px)`
  }
  viewport.addEventListener('pointermove', (e) => placeChat(e.clientX, e.clientY))
  function closeChat(now) {
    if (!chatBox) return
    const box = chatBox
    chatBox = null
    box.remove()
    clearTimeout(chatTimer)
    if (now) roomSend({ t: 'chat', text: '' })
    else {
      roomSend({ t: 'chat', text: box.querySelector('input').value })
      chatClear = setTimeout(() => roomSend({ t: 'chat', text: '' }), 4000)
    }
  }
  // What this person has selected, sent when it changes (looked at four times a second while others are here).
  let selSent = ''
  function mySelection() {
    const ids = chosen ? [...chosen.items] : picked ? withGroup(picked) : []
    const boxes = ids.map((id) => board.items.find((i) => i.id === id)).filter(Boolean).map((i) => { const g = geometryOf(i); return { x: g.x, y: g.y, w: g.w ?? 0, h: g.h ?? 0 } })
    for (const k of chosen?.frames ?? []) { const f = allFrames.get(k); if (f) boxes.push({ x: f.x, y: f.y, w: f.W, h: f.H }) }
    return boxes.length ? boxes : call('selectionBoxes') ?? []
  }
  setInterval(() => {
    if (!peers.size || roomSocket?.readyState !== 1) return
    const boxes = mySelection().map((b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }))
    const now = JSON.stringify([pageId, boxes])
    if (now === selSent) return
    selSent = now
    roomSend({ t: 'sel', page: pageId, boxes })
  }, 250)
  // Figma's follow: a face clicked keeps this view on what that person sees, page and zoom too, until this person pans,
  // zooms or presses a key. What each person sees is sent at most five times a second, only while others are here.
  var following = null
  let spotlit = false
  let viewTimer = 0
  let viewSent = 0
  function sendView(now = false) {
    // peers first: the view is drawn before this part of the script has run, when roomSocket is not yet made.
    if (!peers?.size || !roomSocket) return
    const go = () => {
      viewTimer = 0
      viewSent = Date.now()
      const c = toWorld(viewport.clientWidth / 2, viewport.clientHeight / 2)
      roomSend({ t: 'view', page: pageId, x: c.x, y: c.y, z: view.z })
    }
    if (now) return go()
    if (!viewTimer) viewTimer = setTimeout(go, Math.max(0, 200 - (Date.now() - viewSent)))
  }
  const followRing = h('div', { id: 'follow-ring', hidden: true })
  document.body.append(followRing)
  function startFollow(id) {
    const p = peers.get(id)
    if (!p) return
    following = id
    followRing.style.setProperty('--c', p.color)
    followRing.replaceChildren(h('span', { class: 'follow-tag' }, `Following ${p.name}`, h('button', { type: 'button', onclick: stopFollow }, 'Stop')))
    followRing.hidden = false
    drawPeers()
    if (p.view) followTo(p.view)
    else goToPeer(id)
  }
  function stopFollow() {
    if (!following) return
    following = null
    followRing.hidden = true
    drawPeers()
  }
  function followTo(v) {
    if (v.page !== pageId) goPage(v.page)
    view.z = v.z
    view.x = viewport.clientWidth / 2 - v.x * v.z
    view.y = viewport.clientHeight / 2 - v.y * v.z
    apply()
  }
  // This person moving the board themselves stops following.
  for (const type of ['wheel', 'pointerdown']) viewport.addEventListener(type, () => stopFollow(), { capture: true, passive: true })
  addEventListener('keydown', (e) => { if (following && !e.target.closest?.('input, textarea, [contenteditable]')) stopFollow() }, true)
  /** A face clicked: to the page their pointer is on, with it in the middle of the window. */
  function goToPeer(id) {
    const c = peers.get(id)?.cursor
    if (!c) return hint(`${peers.get(id)?.name ?? 'They'} isn't on the board right now`, 1600)
    if (c.page !== pageId) goPage(c.page)
    view.x = viewport.clientWidth / 2 - c.x * view.z
    view.y = viewport.clientHeight / 2 - c.y * view.z
    apply()
  }

  // ── the thread popover ──
  const thread = $('#thread')
  let threadAt = null
  function openThread(id, fly = false) {
    draft = null
    activeId = id
    const t = threads.find((x) => x.id === id)
    if (!t) return
    markSeen(t)
    const p0 = anchorOf(t)
    if (p0.page !== pageId) goPage(p0.page)
    if (fly) {
      const p = anchorOf(t)
      const z = Math.max(view.z, 0.35)
      view.z = z
      view.x = (viewport.clientWidth - panelWidth()) / 2 - p.x * z
      view.y = viewport.clientHeight / 2 - p.y * z
      apply()
    }
    renderPins()
    showThread({ id })
  }
  function closeThread() {
    draft = null
    activeId = null
    if (thread.contains(document.activeElement)) document.activeElement.blur()
    thread.classList.remove('open')
    renderPins()
  }
  function showThread(what, keepTyping = false) {
    // One dialog at a time: the ask box keeps what was typed in it for when it opens again.
    if ($('#ask').classList.contains('open')) closeAsk()
    const typed = keepTyping ? thread.querySelector('textarea')?.value : ''
    // Drawn again while its reply is being typed (someone else commented): the box keeps the focus and the caret.
    const was = keepTyping && document.activeElement?.matches?.('#thread textarea') ? { s: document.activeElement.selectionStart, e: document.activeElement.selectionEnd } : null
    const t = what.id ? threads.find((x) => x.id === what.id) : null
    const msgs = h('div', { class: 'msgs' })
    const error = h('div', { class: 'error' })
    const textarea = h('textarea', { placeholder: t ? 'Reply' : 'Leave a comment', maxlength: LIMITS.text, rows: '3' })
    if (typed) textarea.value = typed
    // @mentions, as in Figma: an @ and the start of a name offers everyone who has written here; ↑ ↓ choose, Enter or
    // Tab (or a click) puts in @Name.
    const mentionList = h('div', { class: 'mentions', role: 'listbox', hidden: true })
    let mentionAt = -1
    let mentionPick = 0
    const mentionWord = () => /(^|\s)@([\w.-]*)$/.exec(textarea.value.slice(0, textarea.selectionStart))
    const mentionNames = (start) => people().filter((n) => n.toLowerCase().startsWith(start.toLowerCase()) && n !== me).slice(0, 6)
    const drawMentions = () => {
      const m = mentionWord()
      const names = m ? mentionNames(m[2]) : []
      mentionList.hidden = !names.length
      if (!names.length) return
      mentionAt = textarea.selectionStart - m[2].length - 1
      mentionPick = Math.min(mentionPick, names.length - 1)
      mentionList.replaceChildren(...names.map((n, i) => h('button', { type: 'button', role: 'option', class: i === mentionPick ? 'on' : '', 'aria-selected': String(i === mentionPick), onmousedown: (e) => { e.preventDefault(); putMention(n) } }, `@${n}`)))
    }
    const putMention = (n) => {
      const end = textarea.selectionStart
      textarea.value = `${textarea.value.slice(0, mentionAt)}@${n} ${textarea.value.slice(end)}`
      const at = mentionAt + n.length + 2
      textarea.setSelectionRange(at, at)
      mentionList.hidden = true
      textarea.focus()
    }
    textarea.addEventListener('input', () => { mentionPick = 0; drawMentions() })
    textarea.addEventListener('keydown', (e) => {
      if (mentionList.hidden) return
      const names = [...mentionList.children].map((b) => b.textContent.slice(1))
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        mentionPick = (mentionPick + (e.key === 'ArrowDown' ? 1 : -1) + names.length) % names.length
        drawMentions()
      } else if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') {
        e.preventDefault()
        e.stopImmediatePropagation()
        putMention(names[mentionPick])
      } else if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        mentionList.hidden = true
      }
    })
    const nameIn = h('input', { class: 'name-in', placeholder: 'Your name', maxlength: LIMITS.name, value: me, 'aria-label': 'Your name' })
    const forAgent = h('input', { type: 'checkbox' })
    if (what.draft?.agent) forAgent.checked = true
    const submit = h('button', { type: 'submit', class: 'btn' }, t ? 'Reply' : 'Comment')
    const form = h('form', { class: 'composer', onsubmit: async (e) => {
      e.preventDefault()
      const text = textarea.value.trim()
      const name = nameIn.value.trim()
      if (!name) { error.textContent = 'Add your name first.'; nameIn.focus(); return }
      if (!text) { textarea.focus(); return }
      setName(name)
      submit.disabled = true
      error.textContent = ''
      try {
        if (t) {
          await send({ op: 'reply', to: t.id, name, text })
          renderPins()
          showThread({ id: t.id })
        } else {
          const d = what.draft
          const ev = await send({ op: 'add', name, text, frame: d.frame, x: d.x, y: d.y, file: d.file, anchor: d.anchor, agent: forAgent.checked, ...(d.frame ? {} : { page: d.page, item: d.item, dx: d.dx, dy: d.dy }) })
          draft = null
          activeId = ev.id
          renderPins()
          showThread({ id: ev.id })
        }
      } catch (err) {
        error.textContent = err.message
        submit.disabled = false
      }
    } },
      me ? null : nameIn,
      textarea,
      mentionList,
      error,
      h('div', { class: 'row' }, t ? h('span', {}, me ? `as ${me}` : '') : h('label', { title: 'Mark it as work for an agent' }, forAgent, 'For the agent'), h('button', { type: 'button', class: 'btn quiet', onclick: closeThread }, 'Cancel'), submit),
    )
    textarea.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit()
      if (e.key === 'Escape') closeThread()
    })
    // Escape closes the thread from the name field too, not only from the comment.
    nameIn.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') closeThread()
    })
    if (t) {
      // Reactions, as Figma's: each emoji with how many, who on hover, the viewer's own pressed; ☺+ shows the five to
      // pick from under the message, and a click puts the viewer's on or takes it off.
      const reactionsOf = (m) => {
        const mine = (e) => (m.reactions?.[e] ?? []).includes(me || 'someone')
        const toggle = async (e) => {
          try {
            await send({ op: 'react', to: m.id, emoji: e, on: !mine(e), name: me || 'someone' })
            renderPins()
            showThread({ id: t.id })
          } catch (err) { error.textContent = err.message }
        }
        const picker = h('div', { class: 'react-pick', hidden: true }, ...REACTIONS.map((e) => h('button', { type: 'button', class: `react${mine(e) ? ' on' : ''}`, 'aria-label': `React ${e}`, onclick: () => toggle(e) }, e)))
        const chips = Object.entries(m.reactions ?? {}).map(([e, who]) => h('button', { type: 'button', class: `react${mine(e) ? ' on' : ''}`, title: who.join(', '), 'aria-pressed': String(mine(e)), disabled: !api, onclick: () => toggle(e) }, `${e} ${who.length}`))
        return h('div', { class: 'reacts' }, ...chips, api ? h('button', { type: 'button', class: 'react add', title: 'React', 'aria-label': 'React', onclick: () => { picker.hidden = !picker.hidden } }, '☺+') : null, picker)
      }
      for (const m of [{ ...t, root: true }, ...t.replies]) {
        const words = h('p', {}, ...withMentions(m.text))
        // As in Figma, what someone wrote they can edit: its words become a field, kept with Save or Ctrl+Enter.
        const edit = () => {
          const field = h('textarea', { class: 'edit-msg', 'aria-label': 'Edit the comment' })
          field.value = m.text
          const save = async () => {
            const text = field.value.trim()
            if (!text || text === m.text) return showThread({ id: t.id })
            try {
              await send({ op: 'edit', to: m.id, text, name: me || 'someone' })
              renderPins()
              showThread({ id: t.id })
            } catch (err) { error.textContent = err.message }
          }
          field.addEventListener('keydown', (e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
            if (e.key === 'Escape') showThread({ id: t.id })
          })
          words.replaceWith(h('div', { class: 'editing-msg' }, field, h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn quiet', onclick: () => showThread({ id: t.id }) }, 'Cancel'), h('button', { type: 'button', class: 'btn', onclick: save }, 'Save'))))
          field.focus()
        }
        msgs.append(h('div', { class: 'msg' },
          h('div', { class: 'who' }, h('b', {}, m.name), h('span', {}, when(m.at), m.edited ? ' · edited' : ''),
            // A link that opens the canvas on this thread, as Figma's Copy link on a comment.
            m.root ? h('button', { type: 'button', class: 'copy-link', title: 'Copy a link to this thread', onclick: async () => {
              const url = `${location.origin}${location.pathname}#comment=${encodeURIComponent(t.id)}`
              try {
                await navigator.clipboard.writeText(url)
                hint('Link copied. It opens the canvas on this thread.', 1800)
              } catch {
                hint(url, 8000)
              }
            } }, 'Copy link') : null,
            api && me && m.name === me ? h('button', { type: 'button', title: 'Edit what you wrote', onclick: edit }, 'Edit') : null,
            // As in Figma, people delete what they wrote; the owner deletes anything.
            api && (owner() || (me && m.name === me)) ? h('button', { type: 'button', title: m.root ? 'Delete the whole thread' : 'Delete this reply', onclick: async () => {
              if (!(await sure(m.root ? 'Delete this thread and its replies for everyone?' : 'Delete this reply for everyone?', 'Delete', true))) return
              try {
                await send({ op: 'delete', to: m.id, name: me || 'someone' })
                if (m.root) closeThread()
                else { renderPins(); showThread({ id: t.id }) }
              } catch (err) { error.textContent = err.message }
            } }, 'Delete') : null),
          words,
          reactionsOf(m),
          m.root && t.file ? h('div', { class: 'on' }, `On ${t.file}${t.anchor ? ` · ${t.anchor.text ? `“${t.anchor.text.length > 40 ? `${t.anchor.text.slice(0, 40)}…` : t.anchor.text}”` : t.anchor.path}` : ''}`) : null))
      }
    }
    const head = h('div', { class: 'head' },
      h('b', {}, t ? `#${number(t)}` : 'New comment', t?.resolved ? h('span', { class: 'state' }, ' · resolved') : null),
      t && api ? h('button', { type: 'button', class: 'tool', 'aria-pressed': String(!!t.agent), title: t.agent ? 'Marked for the agent: click to clear' : 'Mark it as work for the agent', onclick: async () => {
        try {
          await send({ op: 'agent', to: t.id, name: me || 'someone', agent: !t.agent })
          renderPins()
          showThread({ id: t.id })
        } catch (err) { error.textContent = err.message }
      } }, '✦ Agent') : null,
      t && api ? h('button', { type: 'button', class: 'tool', title: t.resolved ? 'Reopen' : 'Resolve', onclick: async () => {
        try {
          await send({ op: 'resolve', to: t.id, name: me || 'someone', resolved: !t.resolved })
          renderPins()
          showThread({ id: t.id })
        } catch (err) { error.textContent = err.message }
      } }, t.resolved ? 'Reopen' : '✓ Resolve') : null,
      // The thread before or after it, in number order, as Figma steps through comments; resolved ones only when shown.
      ...(t ? (() => {
        const list = threads.filter((x) => showResolved() || !x.resolved || x.id === t.id)
        const at = list.findIndex((x) => x.id === t.id)
        if (list.length < 2) return []
        const go = (d) => openThread(list[(at + d + list.length) % list.length].id, true)
        return [h('button', { type: 'button', class: 'tool', title: 'Previous thread', 'aria-label': 'Previous thread', onclick: () => go(-1) }, '‹'), h('button', { type: 'button', class: 'tool', title: 'Next thread', 'aria-label': 'Next thread', onclick: () => go(1) }, '›')]
      })() : []),
      h('button', { type: 'button', class: 'tool', title: 'Close', 'aria-label': 'Close', onclick: closeThread }, '✕'),
    )
    // Where comments cannot be saved, a thread is read and not answered: no composer at all.
    thread.replaceChildren(...[head, t ? msgs : null, api ? form : null].filter(Boolean))
    thread.classList.add('open')
    threadAt = t ? { thread: t } : { draft: what.draft }
    placeThread()
    if (!keepTyping) (me ? textarea : nameIn).focus({ preventScroll: true })
    else if (was) { textarea.focus({ preventScroll: true }); try { textarea.setSelectionRange(was.s, was.e) } catch {} }
  }
  function placeThread() {
    if (!threadAt || !thread.classList.contains('open')) return
    // In Play, beside its pin over the prototype.
    if (playing && play.classList.contains('open')) {
      const p = threadAt.thread ? playPointOf(threadAt.thread) : playDraft ? playPointOf({ draft: playDraft }) : null
      if (p) {
        const w = thread.offsetWidth || 300
        const hgt = thread.offsetHeight || 200
        const left = p.x + 24 + w > innerWidth - 12 ? Math.max(12, p.x - w - 12) : p.x + 24
        thread.style.left = `${left}px`
        thread.style.top = `${Math.max(56, Math.min(p.y - 30, innerHeight - hgt - 12))}px`
        return
      }
    }
    const p = threadAt.thread ? anchorOf(threadAt.thread) : { x: threadAt.draft.wx, y: threadAt.draft.wy }
    const s = toScreen(p.x, p.y)
    const w = thread.offsetWidth || 300
    // On a line short enough on screen, the thread opens under it (or over it), so what it is about stays in sight.
    const line = p.bottom != null ? { top: toScreen(p.x, p.top).y, bottom: toScreen(p.x, p.bottom).y } : null
    const onLine = line && line.bottom - line.top <= 160 && innerWidth > 640
    let left = onLine ? Math.min(s.x - 24, innerWidth - w - 12) : s.x + 24
    if (!onLine && left + w > innerWidth - 12) left = s.x - w - 12
    left = Math.max(12, left)
    // It ends above the toolbar when it would cross it, shortening (its messages scroll) on a short window.
    // A phone's sheet is placed by the stylesheet.
    let floor = innerHeight - 12
    if (innerWidth > 640) {
      const tb = $('#toolbar').getBoundingClientRect()
      if (tb.height && left < tb.right && left + w > tb.left) floor = tb.top - 8
      thread.style.maxHeight = `${Math.max(180, Math.min(460, floor - 56))}px`
    } else thread.style.maxHeight = ''
    const hgt = thread.offsetHeight || 200
    let top = Math.max(56, Math.min(Math.max(56, s.y - 30), floor - hgt))
    if (onLine && line.bottom + 10 + hgt <= floor) top = line.bottom + 10
    else if (onLine && line.top - 10 - hgt >= 56) top = line.top - 10 - hgt
    else if (onLine) {
      left = s.x + 24 + w > innerWidth - 12 ? Math.max(12, s.x - w - 12) : s.x + 24
    }
    thread.style.left = `${left}px`
    thread.style.top = `${top}px`
  }

  // ── Ask agent ──
  const ask = $('#ask')
  let askTarget = null
  let askRegion = null
  function openAsk() {
    if (!api) return hint(readOnly, 3000)
    if (thread.classList.contains('open')) closeThread()
    askRegion = chosen ? { box: { ...chosen.box }, items: [...chosen.items, ...chosen.frames] } : null
    askTarget = askRegion ? null : call('selectionTarget') ?? null
    const n = askRegion?.items.length
    $('#ask-on').textContent = askRegion ? `On the ${n} thing${n === 1 ? '' : 's'} in the box` : askTarget ? `On ${askTarget.label}` : 'On the board, where the view is centered'
    ask.classList.add('open')
    $('#tool-ask').setAttribute('aria-pressed', 'true')
    $('#ask-error').textContent = ''
    $('#ask-text').focus()
  }
  function closeAsk() {
    ask.classList.remove('open')
    $('#tool-ask').setAttribute('aria-pressed', 'false')
  }
  $('#tool-ask').addEventListener('click', () => (ask.classList.contains('open') ? closeAsk() : openAsk()))
  $('#ask-cancel').addEventListener('click', closeAsk)
  $('#ask-text').addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Escape') closeAsk()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      ask.requestSubmit()
    }
  })
  ask.addEventListener('submit', async (e) => {
    e.preventDefault()
    const text = $('#ask-text').value.trim()
    if (!text) return
    const name = me || (await question('Your name, to sign the request:')) || ''
    if (!name.trim()) return
    setName(name)
    let at
    if (askRegion) {
      const b = askRegion.box
      at = { frame: null, x: b.x + b.w, y: b.y, box: b, items: askRegion.items }
    } else if (askTarget) {
      const f = askTarget.frame
      at = { frame: f.key, x: Math.round((askTarget.wx - f.x) / f.s), y: Math.round((askTarget.wy - f.y) / f.s), file: askTarget.file, anchor: askTarget.anchor }
    } else {
      const c = center()
      const p = toWorld(c.x, c.y)
      const f = frameAt(c.x, c.y)
      at = f ? { frame: f.key, x: Math.round((p.x - f.x) / f.s), y: Math.round((p.y - f.y) / f.s) } : { frame: null, x: p.x, y: p.y }
    }
    try {
      const ev = await send({ op: 'add', name: me, text, agent: true, ...at })
      $('#ask-text').value = ''
      closeAsk()
      renderPins()
      hint('Saved for the agent', 1600)
      activeId = ev.id
      renderPins()
    } catch (err) {
      $('#ask-error').textContent = err.message
    }
  })

  // ── present ──
  const play = $('#play')
  const playFrame = $('#play iframe')
  let playing = null
  let playWidth = 'fill'
  // The screen Play was opened on, where R starts over.
  let playStart = null
  // The screens played before this one, for a prototype's own Back.
  let playTrail = []
  function openPlay(f, width, back = false) {
    if (!play.classList.contains('open')) { playStart = f; playTrail = [] }
    else if (!back && playing && playing !== f) playTrail.push(playing)
    playing = f
    $('#play-title').textContent = `${pages().find((p) => p.id === f.page)?.title ?? ''} · ${f.label}`
    playFrame.srcdoc = docFor(f)
    play.classList.add('open')
    document.body.classList.add('playing')
    playCommentBtn.hidden = !api
    playDraft = null
    playPins.replaceChildren()
    setPlayWidth(width ?? (f.meta.fluid ? 'fill' : store.get('playWidth') || 'fill'))
    const list = playList()
    const at = list.indexOf(f)
    $('#play-count').textContent = list.length > 1 ? `${at + 1} of ${list.length}` : ''
    $('#play-prev').disabled = at <= 0
    $('#play-next').disabled = at < 0 || at >= list.length - 1
    $('#play-prev').hidden = $('#play-next').hidden = list.length < 2
    closeMenu()
  }
  /** The screens of the page being played, in board order: ← and → step through them. */
  const playList = () => [...allFrames.values()].filter((f) => f.page === playing?.page)
  function stepPlay(d) {
    const list = playList()
    const to = list[list.indexOf(playing) + d]
    if (to) openPlay(to, playWidth)
  }
  /** Keys in the parent page or the prototype: Esc leaves, ← → step, unless the prototype took the key or a field has it. */
  function playKey(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return
    if (e.key === 'Escape') closePlay()
    else if (e.key === 'ArrowRight') stepPlay(1)
    else if (e.key === 'ArrowLeft') stepPlay(-1)
    else if ((e.key === 'c' || e.key === 'C') && api) setPlayCommenting(playCatch.hidden)
    // Figma's R: start over from the screen Play was opened on, as it first was (anything typed or opened in it gone).
    else if ((e.key === 'r' || e.key === 'R') && playStart) { openPlay(playStart, playWidth, true); playTrail = [] }
    else return
    e.preventDefault()
  }
  // A click on nothing that does anything lights up, for a moment, everything that does, as a Figma prototype shows its
  // hotspots, so the way on is found without guessing.
  const HOT = 'a[href], button, input, select, textarea, summary, label[for], [onclick], [role="button"], [role="link"], [role="tab"], [tabindex]:not([tabindex="-1"])'
  function showHotspots(doc) {
    const els = [...doc.querySelectorAll(HOT)].filter((x) => x.getClientRects().length)
    if (!els.length) return
    let style = doc.getElementById('dc-hotspots')
    if (!style) {
      style = doc.createElement('style')
      style.id = 'dc-hotspots'
      style.textContent = '[data-dc-hot]{outline:2px solid rgba(37,99,235,.85)!important;outline-offset:2px!important;box-shadow:inset 0 0 0 9999px rgba(37,99,235,.14)!important}'
      doc.head.append(style)
    }
    for (const x of els) x.setAttribute('data-dc-hot', '')
    clearTimeout(showHotspots.timer)
    showHotspots.timer = setTimeout(() => { for (const x of doc.querySelectorAll('[data-dc-hot]')) x.removeAttribute('data-dc-hot') }, 700)
  }
  playFrame.addEventListener('load', () => {
    playFrame.contentDocument?.addEventListener('keydown', playKey)
    playFrame.contentDocument?.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.target.closest?.(HOT) || !playCatch.hidden) return
      showHotspots(playFrame.contentDocument)
    })
    // Pins over the prototype follow it as it scrolls, and as its page settles.
    playFrame.contentWindow?.addEventListener('scroll', () => { renderPlayPins(); placeThread() }, { passive: true })
    renderPlayPins()
    setTimeout(renderPlayPins, 400)
  })
  $('#play-prev').addEventListener('click', () => stepPlay(-1))
  $('#play-next').addEventListener('click', () => stepPlay(1))
  /** On a touch screen a fixed width as wide as the screen or wider does nothing a finger can use. */
  const widthFits = (n) => !matchMedia('(pointer: coarse)').matches || n < innerWidth - 24
  function showPlayWidths() {
    let any = false
    for (const b of play.querySelectorAll('[data-width]')) {
      if (!/^\d+$/.test(b.dataset.width)) continue
      b.hidden = !widthFits(Number(b.dataset.width))
      any ||= !b.hidden
    }
    $('#play .head .sep').hidden = !any
  }
  function setPlayWidth(w) {
    showPlayWidths()
    if (/^\d+$/.test(String(w)) && !widthFits(Number(w))) w = 'fill'
    playWidth = w
    store.set('playWidth', w)
    play.classList.toggle('fit', w === 'fit')
    const stage = $('#play .stage')
    playFrame.style.transform = ''
    if (w === 'fill') Object.assign(playFrame.style, { width: '100%', height: '100%' })
    else if (w === 'fit') {
      const sw = stage.clientWidth - 24
      const sh = stage.clientHeight - 24
      const s = Math.min(1, sw / playing.w)
      Object.assign(playFrame.style, { width: `${playing.w}px`, height: `${sh / s}px`, transform: `scale(${s})`, margin: `0 ${Math.max(0, (sw - playing.w * s) / 2)}px` })
    } else Object.assign(playFrame.style, { width: `${w}px`, height: '100%', margin: '0 auto' })
    if (w !== 'fit') playFrame.style.margin = '0 auto'
    for (const b of play.querySelectorAll('[data-width]')) b.setAttribute('aria-pressed', String(b.dataset.width === String(w)))
    requestAnimationFrame(() => renderPlayPins())
  }
  for (const b of play.querySelectorAll('[data-width]')) b.addEventListener('click', () => setPlayWidth(b.dataset.width))
  $('#play-close').addEventListener('click', () => closePlay())
  $('#play-download').addEventListener('click', () => playing && downloadFile(playing.file))
  function closePlay() {
    play.classList.remove('open')
    document.body.classList.remove('playing')
    setPlayCommenting(false)
    playPins.replaceChildren()
    playDraft = null
    playFrame.srcdoc = ''
    playing = null
  }

  // ── comments in Play: C (or the button) and a click on the prototype pins a thread to the element there, as on the
  // board, so it shows in both; the pins for the screen played sit over it and follow its scrolling ──
  const playPins = $('#play-pins')
  const playCatch = $('#play-catch')
  const playCommentBtn = $('#play-comment')
  let playDraft = null
  function setPlayCommenting(on) {
    playCatch.hidden = !on
    playCommentBtn.setAttribute('aria-pressed', String(on))
  }
  playCommentBtn.addEventListener('click', () => setPlayCommenting(playCatch.hidden))
  /** Where a thread's pin is on screen while its prototype is played, or null when it is not on this one. */
  function playPointOf(t) {
    const doc = playing && play.classList.contains('open') ? playFrame.contentDocument : null
    if (!doc?.body) return null
    const fr = playFrame.getBoundingClientRect()
    const k = fr.width / (playFrame.offsetWidth || fr.width) || 1
    let el = null
    let dx = 0
    let dy = 0
    if (t.draft) ({ el, dx, dy } = t.draft)
    else {
      if (t.frame !== playing.key) return null
      el = call('elementOfAnchor', doc, t)
      dx = t.anchor?.dx ?? 0
      dy = t.anchor?.dy ?? 0
    }
    if (el?.isConnected) {
      const r = el.getBoundingClientRect()
      return { x: fr.left + (r.left + Math.min(dx, r.width)) * k, y: fr.top + (r.top + Math.min(dy, r.height)) * k }
    }
    if (t.x == null) return null
    const sc = doc.scrollingElement
    return { x: fr.left + (t.x - (sc?.scrollLeft ?? 0)) * k, y: fr.top + (t.y - (sc?.scrollTop ?? 0)) * k }
  }
  function renderPlayPins() {
    playPins.replaceChildren()
    if (!playing || !play.classList.contains('open')) return
    const stage = play.querySelector('.stage').getBoundingClientRect()
    const shown = (p) => p && p.x >= stage.left && p.x <= stage.right && p.y >= stage.top && p.y <= stage.bottom + 28
    for (const t of threads) {
      if (t.frame !== playing.key || (t.resolved && !showResolved())) continue
      const p = playPointOf(t)
      if (!shown(p)) continue
      playPins.append(h('button', {
        type: 'button',
        class: `pin${t.resolved ? ' resolved' : ''}${t.agent ? ' agent' : ''}${t.id === activeId ? ' active' : ''}`,
        style: `left:${p.x}px;top:${p.y}px`,
        title: `${t.name}: ${t.text}`,
        onclick: (e) => { e.stopPropagation(); openThread(t.id) },
      }, String(number(t))))
    }
    if (draft && playDraft) {
      const p = playPointOf({ draft: playDraft })
      if (shown(p)) playPins.append(h('div', { class: 'pin active', style: `left:${p.x}px;top:${p.y}px` }, '+'))
    }
  }
  playCatch.addEventListener('click', (e) => {
    setPlayCommenting(false)
    if (!api) return hint(readOnly, 3000)
    const doc = playFrame.contentDocument
    if (!doc || !playing) return
    const fr = playFrame.getBoundingClientRect()
    const k = fr.width / (playFrame.offsetWidth || fr.width) || 1
    const x = (e.clientX - fr.left) / k
    const y = (e.clientY - fr.top) / k
    const el = doc.elementFromPoint(x, y)
    if (!el) return
    const r = el.getBoundingClientRect()
    const sc = doc.scrollingElement
    const f = playing
    const docX = x + (sc?.scrollLeft ?? 0)
    const docY = y + (sc?.scrollTop ?? 0)
    playDraft = { el, dx: x - r.left, dy: y - r.top }
    const anchor = el.localName === 'html' || el.localName === 'body' ? undefined : call('anchorOfElement', el, x - r.left, y - r.top)
    draft = { wx: f.x + docX * f.s, wy: f.y + docY * f.s, frame: f.key, x: Math.round(docX), y: Math.round(docY), page: f.page, agent: false, ...(anchor ? { file: f.file, anchor } : {}) }
    activeId = null
    renderPins()
    showThread({ draft })
  })
  addEventListener('resize', () => renderPlayPins())
  // A link to another prototype, posted by the frame: move to that prototype.
  addEventListener('message', (e) => {
    if (e.data?.dc === 'back' && e.source === playFrame.contentWindow && playing) {
      const to = playTrail.pop()
      if (to && allFrames.has(to.key)) openPlay(allFrames.get(to.key), playWidth, true)
      else hint('This is the first screen played', 1600)
      return
    }
    if (!e.data || e.data.dc !== 'go' || e.source !== playFrame.contentWindow) return
    const [file, hash = ''] = String(e.data.href).replace(/^\.\//, '').split('#')
    const to = [...allFrames.values()].find((f) => f.file === file && (f.hash || '') === hash) ?? [...allFrames.values()].find((f) => f.file === file)
    if (to) openPlay(to, playWidth)
    else hint(`${file} is not on this canvas`, 2500)
  })
  $('#tool-play').addEventListener('click', (e) => {
    const fs = frames()
    const live = fs.filter((f) => f.meta.play)
    const still = fs.filter((f) => !f.meta.play)
    openMenu(e.currentTarget, [
      { label: flowsOn ? 'Hide flows' : 'Show flows on the board', run: toggleFlows },
      '-',
      live.length ? { note: 'Interactive' } : null,
      ...live.map((f) => ({ label: f.label, run: () => openPlay(f) })),
      still.length ? { note: 'Static artboards' } : null,
      ...still.map((f) => ({ label: `${f.label}${f.meta.fluid ? ' (fluid)' : ''}`, run: () => openPlay(f) })),
      fs.length ? null : { note: 'Nothing on this page to present.' },
    ].filter(Boolean))
  })

  // ── menus ──
  const menu = $('#menu')
  let menuFor = null
  function openMenu(anchor, entries) {
    if (menu.classList.contains('open') && menuFor === anchor) return closeMenu()
    menuFor = anchor
    // Measured before the menu is redrawn: the anchor may be one of the rows about to go.
    const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y }
    menu.replaceChildren(...entries.map((m) => {
      if (m === '-') return h('hr')
      if (m.note) return h('div', { class: 'note' }, m.note)
      return h('button', { type: 'button', class: `mi${m.danger ? ' danger' : ''}`, role: 'menuitem', disabled: m.disabled, onclick: (e) => { e.stopPropagation(); if (!m.keep) closeMenu(); m.run?.(e) } },
        h('span', { class: 'tick' }, m.tick ? '✓' : m.icon ? icon(m.icon) : ''),
        h('span', { class: 'grow', style: m.font ? `font-family:${m.font}` : null }, m.label),
        m.key ? h('span', { class: 'key' }, m.key) : null,
        m.more ? h('button', { type: 'button', class: 'dots', title: 'More', onclick: (e) => { e.stopPropagation(); m.more(e.currentTarget) } }, '…') : null)
    }))
    menu.classList.add('open')
    const mw = menu.offsetWidth
    const mh = menu.offsetHeight
    let left = Math.min(r.left, innerWidth - mw - 8)
    let top = r.bottom + 6
    if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6)
    menu.style.left = `${Math.max(8, left)}px`
    menu.style.top = `${top}px`
    anchor.setAttribute?.('aria-expanded', 'true')
    // Opened from the keyboard, the first item takes the focus; arrows move it (menuKeys).
    if (anchor.matches?.(':focus-visible')) menuItems()[0]?.focus()
  }
  // ── the question box: the page's own prompt and confirm ──
  const dialog = $('#dialog')
  let dialogDone = null
  dialog.addEventListener('close', () => {
    const done = dialogDone
    dialogDone = null
    done?.(dialog.returnValue === 'ok')
  })
  // Keys typed in the box are the box's, not the board's shortcuts.
  dialog.addEventListener('keydown', (e) => e.stopPropagation())
  function openDialog(message, { value = null, ok = 'OK', danger = false } = {}) {
    if (dialog.open) dialog.close('cancel')
    const input = $('#dialog-val')
    $('#dialog-msg').textContent = message
    input.hidden = value == null
    input.value = value ?? ''
    const okBtn = $('#dialog-ok')
    okBtn.textContent = ok
    okBtn.classList.toggle('danger', danger)
    dialog.returnValue = ''
    return new Promise((resolve) => {
      dialogDone = (yes) => resolve(value == null ? yes : yes ? input.value : null)
      dialog.showModal()
      if (value != null) { input.focus(); input.select() } else okBtn.focus()
    })
  }
  /** A line of text from the person, or null if they cancel. */
  const question = (message, value = '') => openDialog(message, { value: String(value ?? '') })
  /** Yes or no; `ok` names the yes button, `danger` colors it as a delete. */
  const sure = (message, ok = 'OK', danger = false) => openDialog(message, { ok, danger })
  const menuItems = () => [...menu.querySelectorAll(':scope > .mi:not(:disabled)')]
  function closeMenu(refocus) {
    const was = menuFor
    menu.classList.remove('open')
    menuFor = null
    was?.setAttribute?.('aria-expanded', 'false')
    if (refocus && menu.contains(document.activeElement)) was?.focus?.()
  }
  menu.addEventListener('keydown', (e) => {
    const items = menuItems()
    const at = items.indexOf(document.activeElement)
    const go = (i) => { e.preventDefault(); e.stopPropagation(); items[(i + items.length) % items.length]?.focus() }
    if (e.key === 'ArrowDown') go(at + 1)
    else if (e.key === 'ArrowUp') go(at < 0 ? -1 : at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(-1)
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true) }
    else if (e.key === 'Tab') closeMenu(true)
  })
  addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#menu, [aria-haspopup]')) closeMenu()
  }, true)

  // ── keyboard shortcuts (Shift+?): every key the canvas answers, in one sheet ──
  const SHORTCUTS = [
    ['Tools', [['V', 'Select'], ['H or Space', 'Hand'], ['T', 'Text'], ['N', 'Sticky note'], ['P', 'Pencil'], ['E', 'Stamp'], ['R', 'Rectangle'], ['O', 'Ellipse'], ['L, Shift+L', 'Line, arrow'], ['S', 'Section'], ['Shift, Alt while drawing', 'Square or level, from the middle'], ['A', 'Artboard'], ['C', 'Comment']]],
    ['View', [['Shift+1 or F', 'Zoom to fit'], ['Shift+2', 'Zoom to selection'], ['Page Down, Page Up', 'Next, previous screen'], ['+ and −, Ctrl+= and Ctrl+−', 'Zoom in and out'], ['0, Shift+0 or Ctrl+0', '100%'], ['Ctrl+F', 'Find and replace'], ['Ctrl+Alt+O', 'Show or hide outlines'], ['Ctrl+Shift+\\', 'Hide or show the bars'], ['Ctrl+\\', 'Panel']]],
    ['Board objects', [['Ctrl+A', 'Select everything on the page'], ['Ctrl+Shift+A', 'Select everything not selected'], ['Ctrl+Alt+A', 'Select matching: same kind and color'], ['Tab, Shift+Tab', 'Next or previous object'], ['Enter', 'Type in the one picked'], ['Shift+click', 'Add to the selection'], ['Ctrl+G, Ctrl+Shift+G', 'Group, ungroup'], ['Ctrl+Alt+G', 'Wrap in a section'], ['Ctrl+D', 'Duplicate'], ['Alt+drag', 'Drop a copy'], ['Ctrl+C, Ctrl+X, Ctrl+V', 'Copy, cut, paste'], ['Ctrl+Shift+V', 'Paste in place'], ['Ctrl+Shift+R', 'Paste to replace what is selected'], ['Ctrl+Shift+C', 'Copy as PNG'], ['Ctrl+Shift+L', 'Lock or unlock'], ['Ctrl+], Ctrl+[', 'Forward, backward'], ['Ctrl+Shift+], Ctrl+Shift+[', 'To front, to back'], ['Alt+A, H, D', 'Align left, centers, right'], ['Alt+W, V, S', 'Align top, middles, bottom'], ['Alt+Shift+H, V', 'Space evenly across, down'], ['Shift+H, Shift+V', 'Flip across, flip up and down'], ['Ctrl+Alt+T', 'Tidy up into a grid'], ['Arrows, Shift+arrows', 'Nudge 1, 10'], ['Ctrl+drag', 'Move without snapping'], ['Shift+drag', 'Move straight across or down; resize in proportion'], ['Alt+drag a corner', 'Resize from the middle'], ['Alt (held)', 'Measure to what is pointed at'], ['Delete', 'Delete']]],
    ['In a prototype', [['Ctrl+click', 'Select instead of clicking'], ['Alt+click', 'Select every copy like it'], ['Ctrl+A', 'Select everything alongside it'], ['Ctrl+Shift+A', 'Select what sits alongside it, leaving it out'], ['Ctrl+Alt+A', 'Select every copy like it'], ['Enter, Shift+Enter', 'Edit text or select its children, go out'], ['Esc', 'Select the parent'], ['Tab, Shift+Tab', 'Next or previous sibling'], ['Alt (held)', 'Measure to what is pointed at'], ['Arrows, Shift+arrows', 'Nudge 1, 10'], ['Alt+arrows', 'Move one place in the flow'], ['Ctrl+], Ctrl+[', 'Forward, backward'], ['Ctrl+Shift+], Ctrl+Shift+[', 'To front, to back'], ['Alt+drag', 'Drop a copy'], ['Shift+drag', 'Straight across or down; resize in proportion'], ['Ctrl+B, I, U, K', 'Bold, italic, underline, link while typing'], ['Ctrl+Shift+X', 'Strikethrough'], ['Ctrl+Shift+8, Ctrl+Shift+7', 'Bulleted list, numbered list'], ['Ctrl+C, Ctrl+X, Ctrl+V', 'Copy, cut, paste after it'], ['Ctrl+Shift+R', 'Paste to replace it'], ['Ctrl+Shift+C', 'Copy as PNG'], ['Ctrl+Alt+C, Ctrl+Alt+V', 'Copy, paste properties'], ['Ctrl+R', 'Rename in Layers, or several at once'], ['Alt+L', 'Collapse every layer'], ['Alt+click a ▸', 'Open or close every layer inside'], ['Ctrl+Shift+H', 'Hide or show'], ['Ctrl+Shift+L', 'Lock or unlock a part'], ['Ctrl+Alt+L, T, R, J', 'Align text left, center, right, justified'], ['Ctrl+Shift+>, Ctrl+Shift+<', 'Text 1px bigger, smaller'], ['Ctrl+Alt+>, Ctrl+Alt+<', 'Bolder, lighter'], ['Alt+>, Alt+<', 'Letter spacing up, down'], ['Alt+Shift+>, Alt+Shift+<', 'Line height up, down'], ['Shift+A', 'Add auto layout'], ['Shift+H, Shift+V', 'Flip across, flip up and down'], ['Ctrl+Alt+K', 'Make component'], ['Ctrl+D', 'Duplicate (a whole screen too)'], ['Ctrl+G, Ctrl+Shift+G', 'Wrap, unwrap']]],
    ['Playing a prototype', [['← and →', 'Previous and next screen on the page'], ['C', 'Comment on it, then click where'], ['R', 'Start over from the first screen'], ['Esc', 'Back to the canvas']]],
    ['Everywhere', [['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z or Ctrl+Y', 'Redo'], ['Shift+C', 'Show or hide comments'], ['/', 'Cursor chat: words by your pointer for others here'], ['Ctrl+Alt+\\', "Hide or show others' pointers"], ['Shift+?', 'This sheet']]],
  ]
  const keysSheet = h('dialog', { id: 'keys-sheet', 'aria-label': 'Keyboard shortcuts' })
  document.body.append(keysSheet)
  keysSheet.addEventListener('keydown', (e) => e.stopPropagation())
  keysSheet.addEventListener('click', (e) => e.target === keysSheet && keysSheet.close())
  function openKeys() {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform)
    const say = (k) => (mac ? k.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/\bAlt\b/g, '⌥') : k)
    keysSheet.replaceChildren(
      h('header', {}, h('b', {}, 'Keyboard shortcuts'), h('button', { type: 'button', class: 'tool', 'aria-label': 'Close', onclick: () => keysSheet.close() }, '✕')),
      h('div', { class: 'keys-cols' }, ...SHORTCUTS.map(([group, rows]) => h('section', {}, h('h3', {}, group), ...rows.map(([k, what]) => h('div', { class: 'key-row' }, h('span', {}, what), h('kbd', {}, say(k))))))),
    )
    keysSheet.showModal()
  }
  // History, as Figma's version history: every edit recorded in the canvas, newest first, who made it, when, in which
  // prototype and what it did; Show goes to that prototype. Served or editing from disk it is read live; else from the file.
  const historySheet = h('dialog', { id: 'history-sheet', class: 'sheet', 'aria-label': 'History' })
  document.body.append(historySheet)
  historySheet.addEventListener('keydown', (e) => e.stopPropagation())
  historySheet.addEventListener('click', (e) => e.target === historySheet && historySheet.close())
  async function copyInvite() {
    try {
      const res = await fetch('/api/invite')
      const body = await res.json()
      if (!res.ok) return hint(body.error || "This canvas isn't in its room yet. Check the owner key.", 4000)
      try {
        await navigator.clipboard.writeText(body.link)
        hint('Invite link copied. People who open it can edit with you while this canvas is running.', 3000)
      } catch {
        hint(body.link, 10000)
      }
    } catch (err) {
      hint(err.message, 3000)
    }
  }
  async function openHistory() {
    let edits = editLines
    if (serve) {
      try { edits = (await (await fetch('/api/history')).json()).edits ?? edits } catch {}
    }
    const list = [...edits].filter((e) => e.summary || e.file).reverse()
    const rows = list.slice(0, 500).map((e) => {
      const f = [...allFrames.values()].find((x) => x.file === e.file)
      return h('div', { class: 'hist-row' },
        h('div', { class: 'hist-head' }, h('b', {}, e.name || 'someone'), h('span', {}, when(e.at)), e.file ? h('span', { class: 'file' }, e.file) : null,
          f ? h('button', { type: 'button', class: 'mini', onclick: () => { historySheet.close(); showFrame(f) } }, 'Show') : null),
        h('div', { class: 'hist-what' }, e.summary || e.op))
    })
    historySheet.setAttribute('aria-label', 'History')
    historySheet.replaceChildren(
      h('header', {}, h('b', {}, `History · ${list.length} edit${list.length === 1 ? '' : 's'}`), h('button', { type: 'button', class: 'tool', 'aria-label': 'Close', onclick: () => historySheet.close() }, '✕')),
      h('div', { class: 'hist-list' }, rows.length ? rows : h('p', { class: 'empty' }, 'No edits recorded yet.')),
    )
    historySheet.showModal()
  }
  // Figma's Show/Hide UI: the top bar, the tools, the panel and the selection's bar hidden, leaving the board and what
  // is on it; a small button in the corner (for a touch screen) and the same key bring them back. Not kept: a reload
  // shows them.
  const barsBack = h('button', { type: 'button', id: 'bars-back', title: 'Show the bars again (Ctrl+Shift+\\)', onclick: () => setBarsShown(true) }, 'Show the bars')
  document.body.append(barsBack)
  function setBarsShown(on) {
    document.body.classList.toggle('ui-off', !on)
    closeMenu()
    if (!on) hint('Bars hidden. Ctrl+Shift+\\ or the button in the corner shows them again.', 2400)
    requestAnimationFrame(() => call('onView'))
  }
  // ── voting, as FigJam's: a session with so many votes for each person; a vote is a dot (a stamp naming the
  // session) on a note or shape; others' dots stay hidden until it ends, then everyone sees them all and the count ──
  // var, not const: the board is drawn (and this read) before the script gets here.
  var voteChip = h('button', { type: 'button', id: 'vote-chip', hidden: true, onclick: () => endVoting() })
  timerChip.after(voteChip)
  var votingSeen = null
  function myVotes(v) { return board.items.filter((i) => i.kind === 'stamp' && i.vote === v.id && i.by === (me || '')) }
  async function startVoting(n) {
    const name = me || (await question('Your name, so your votes are yours:')) || ''
    if (!name.trim()) return
    setName(name)
    try { await sendBoard({ op: 'vote', on: true, votes: n }) } catch (err) { return hint(err.message, 3000) }
    drawVoting()
    hint(`Voting: ${n} votes each. Click a note or shape to vote for it, a dot of yours to take it back.`, 4000)
  }
  async function endVoting() {
    const v = board.voting
    if (!v || !(await sure('End voting for everyone and show the votes?', 'End voting'))) return
    try { await sendBoard({ op: 'vote', on: false }) } catch (err) { return hint(err.message, 3000) }
    drawVoting()
  }
  function castVote(p, itemEl) {
    const v = board.voting
    const mine = itemEl ? board.items.find((i) => i.id === itemEl.dataset.id) : null
    if (mine?.kind === 'stamp' && mine.vote === v.id && mine.by === (me || '')) {
      sendBoard({ op: 'remove', id: mine.id }).then(() => { renderItems(); drawVoting() }, (err) => hint(err.message, 3000))
      return true
    }
    const on = stampTarget(p.x, p.y)
    if (!on || !['note', 'rect', 'ellipse', 'diamond', 'triangle', 'image', 'title'].includes(on.kind)) return false
    if (!me) { question('Your name, so your votes are yours:').then((n) => { if (n?.trim()) setName(n) }); return true }
    if (myVotes(v).length >= v.votes) { hint('No votes left. Click one of your dots to take it back.', 2200); return true }
    const x = Math.round(p.x - 14)
    const y = Math.round(p.y - 14)
    addItem({ kind: 'stamp', w: 28, h: 28, text: '', vote: v.id, x, y, to: on.id, dx: Math.round(x - on.x), dy: Math.round(y - on.y) }).then(() => { renderItems(); drawVoting() })
    return true
  }
  /** The chip in the top bar while voting (votes left; a click ends it), and the count shown when a session ends. */
  function drawVoting() {
    if (!voteChip) return
    const v = board.voting
    voteChip.hidden = !v
    if (v) voteChip.textContent = `Voting · ${Math.max(0, v.votes - myVotes(v).length)} of ${v.votes} left · End`
    document.body.classList.toggle('voting', !!v)
    if (votingSeen && !v) openVoteCount(votingSeen)
    votingSeen = v?.id ?? null
  }
  function openVoteCount(session) {
    const on = new Map()
    for (const st of board.items.filter((i) => i.kind === 'stamp' && i.vote === session && i.to)) {
      const it = board.items.find((i) => i.id === st.to)
      if (!it) continue
      const c = on.get(it.id) ?? { it, n: 0, by: new Map() }
      c.n++
      c.by.set(st.by || 'someone', (c.by.get(st.by || 'someone') ?? 0) + 1)
      on.set(it.id, c)
    }
    const list = [...on.values()].sort((a, b) => b.n - a.n)
    const label = (it) => `${{ note: 'Note', rect: 'Rectangle', ellipse: 'Ellipse', diamond: 'Diamond', triangle: 'Triangle', image: 'Picture', title: 'Title' }[it.kind] ?? it.kind}${it.text ? ` "${String(it.text).slice(0, 40)}${String(it.text).length > 40 ? '…' : ''}"` : ''}`
    const rows = list.map((c) => h('div', { class: 'hist-row stamp-row' },
      h('div', { class: 'hist-head' }, h('b', {}, String(c.n)), h('span', {}, label(c.it)),
        h('button', { type: 'button', class: 'mini', onclick: () => { historySheet.close(); if ((c.it.page ?? firstPage()) !== pageId) goPage(c.it.page ?? firstPage()); pickItem(c.it.id); zoomToSelection() } }, 'Show')),
      h('div', { class: 'hist-what' }, [...c.by.entries()].map(([who, n]) => `${who} ${n}`).join('   '))))
    historySheet.setAttribute('aria-label', 'Votes')
    historySheet.replaceChildren(
      h('header', {}, h('b', {}, `Votes · ${list.reduce((s, c) => s + c.n, 0)} on ${list.length}`), h('button', { type: 'button', class: 'tool', 'aria-label': 'Close', onclick: () => historySheet.close() }, '✕')),
      h('div', { class: 'hist-list' }, rows.length ? rows : h('p', { class: 'empty' }, 'Nobody voted.')),
    )
    if (!historySheet.open) historySheet.showModal()
  }
  // The stamps on this page counted, as a FigJam vote's results and Canva's sort by reactions: each note, shape or
  // picture with stamps on it, most first, each kind of stamp with how many; Show goes to it.
  function openStampCount() {
    const on = new Map()
    for (const st of items().filter((i) => i.kind === 'stamp' && i.to)) {
      const it = board.items.find((i) => i.id === st.to)
      if (!it) continue
      const c = on.get(it.id) ?? { it, n: 0, by: new Map() }
      c.n++
      c.by.set(st.text, (c.by.get(st.text) ?? 0) + 1)
      on.set(it.id, c)
    }
    const list = [...on.values()].sort((a, b) => b.n - a.n)
    const label = (it) => `${{ note: 'Note', rect: 'Rectangle', ellipse: 'Ellipse', diamond: 'Diamond', triangle: 'Triangle', section: 'Section', image: 'Picture' }[it.kind] ?? it.kind}${it.text ? ` "${String(it.text).slice(0, 40)}${String(it.text).length > 40 ? '…' : ''}"` : ''}`
    const rows = list.map((c) => h('div', { class: 'hist-row stamp-row' },
      h('div', { class: 'hist-head' }, h('b', {}, String(c.n)), h('span', {}, label(c.it)),
        h('button', { type: 'button', class: 'mini', onclick: () => { historySheet.close(); pickItem(c.it.id); zoomToSelection() } }, 'Show')),
      h('div', { class: 'hist-what' }, [...c.by.entries()].sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g} ${n}`).join('   '))))
    historySheet.setAttribute('aria-label', 'Stamps, counted')
    historySheet.replaceChildren(
      h('header', {}, h('b', {}, `Stamps, counted · ${list.length} with stamps`), h('button', { type: 'button', class: 'tool', 'aria-label': 'Close', onclick: () => historySheet.close() }, '✕')),
      h('div', { class: 'hist-list' }, rows.length ? rows : h('p', { class: 'empty' }, 'Nothing on this page has a stamp on it yet: E takes the stamp tool.')),
    )
    historySheet.showModal()
  }
  // The canvas's own menu, on its title.
  $('#title-btn').addEventListener('click', (e) => {
    // Only what works where the canvas is open: renaming needs editing on, rebuilding needs node serving it.
    const sel = call('selectedFile') ?? null
    openMenu(e.currentTarget, [
      { note: `Built ${when(data.builtAt)}${editLines.length ? ` · ${editLines.length} edit${editLines.length === 1 ? '' : 's'} recorded` : ''}` },
      '-',
      { label: 'Download the canvas', icon: 'download', run: downloadCanvas },
      sel ? { label: `Download ${sel}`, icon: 'download', run: () => downloadFile(sel) } : null,
      serve ? { label: 'Rename', run: rename } : null,
      { label: 'History', run: openHistory },
      { label: 'Hide the bars', key: 'Ctrl+Shift+\\', run: () => setBarsShown(false) },
      { label: outlinesOn ? 'Hide outlines' : 'Show outlines', key: 'Ctrl+Alt+O', run: () => setOutlines(!outlinesOn) },
      peers.size ? { label: document.body.classList.contains('pointers-off') ? "Show others' pointers" : "Hide others' pointers", key: 'Ctrl+Alt+\\', run: () => setPointersShown(document.body.classList.contains('pointers-off')) } : null,
      // FigJam's timer, for everyone here.
      { label: timerEnd ? 'Timer: stop' : 'Timer…', run: () => (timerEnd ? startTimer(0) : setTimeout(() => openMenu($('#title-btn'), [1, 3, 5, 10].map((n) => ({ label: `${n} minute${n === 1 ? '' : 's'}`, run: () => startTimer(n * 60000) }))), 0)) },
      // Figma's Spotlight: everyone else here follows this view.
      peers.size ? { label: spotlit ? 'Stop the spotlight' : 'Spotlight me', run: () => { spotlit = !spotlit; roomSend({ t: 'spotlight', on: spotlit }); if (spotlit) sendView(true); hint(spotlit ? 'Everyone here is following you.' : 'Everyone can look around on their own again.', 2000) } } : null,
      // The owner's canvas, host of a hosted room: the hosted copy's address with the invite key.
      serve && !local && data.room && data.url ? { label: 'Copy invite link', run: copyInvite } : null,
      items().some((i) => i.kind === 'stamp') ? { label: 'Stamps, counted', run: openStampCount } : null,
      // FigJam's voting session, for everyone on the canvas.
      serve && !board.voting ? { label: 'Start voting…', run: () => setTimeout(() => openMenu($('#title-btn'), [{ note: 'Votes for each person' }, ...[3, 5, 10].map((n) => ({ label: `${n} votes`, run: () => startVoting(n) }))]), 0) } : null,
      serve && board.voting ? { label: 'End voting', run: endVoting } : null,
      // A board laid out for a retro, a kanban, a journey map or a flowchart.
      serve ? { label: 'Templates…', run: () => setTimeout(() => templateMenu($('#title-btn')), 0) } : null,
      // Which element a click in a prototype picks: the one under the pointer, or the outermost block (as Figma), a
      // click inside the selection then going one level in. Kept in this browser.
      { label: `Click selects the exact item${store.get('clickDepth') === 'outer' ? '' : '  ✓'}`, run: () => { store.set('clickDepth', 'inner'); hint('A click now selects exactly what you click. Press Esc to select what holds it.', 2200) } },
      { label: `Click selects the whole block${store.get('clickDepth') === 'outer' ? '  ✓' : ''}`, run: () => { store.set('clickDepth', 'outer'); hint('A click now selects the whole block, as in Figma. Click inside it again to go deeper.', 2600) } },
      { label: 'Keyboard shortcuts', key: 'Shift+?', run: openKeys },
      window.designCanvas?.startOver ? { label: 'Start over', run: () => window.designCanvas.startOver() } : null,
      serve && !data.memory && !local ? { label: 'Refresh from the prototypes', run: rebuild } : null,
      // Under 900 px the top bar has no room for the layout's links, so they are here.
      ...(matchMedia('(max-width: 900px)').matches && data.links?.length ? ['-', ...data.links.filter((l) => /^https?:\/\//i.test(l?.href ?? '') && l.text).map((l) => ({ label: String(l.text), run: () => open(l.href, '_blank', 'noopener') }))] : []),
    ].filter(Boolean))
  })
  async function downloadCanvas() {
    const name = (data.canvas ?? decodeURIComponent(location.pathname)).split(/[\\/]/).pop().replace(/^$|^[^.]*$/, 'canvas.html')
    if (serve) {
      const res = await fetch('/api/canvas', { cache: 'no-store' })
      return save(name, await res.text())
    }
    save(name, asBuilt)
  }
  async function rename() {
    const title = await question('Rename the canvas:', data.title)
    if (!title?.trim() || title.trim() === data.title) return
    try {
      await sendBoard({ op: 'name', title: title.trim() })
      setTitle()
    } catch (err) {
      hint(err.message, 3000)
    }
  }
  async function rebuild() {
    hint('Rebuilding from the prototypes…', 4000)
    const res = await fetch('/api/refresh', { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) hint(body.error || 'The rebuild failed', 5000)
  }
  function setTitle() {
    const title = board.name || data.title
    $('#canvas-title').textContent = title
    document.title = title
    samePageName()
  }
  /** A page named the same as the canvas shows only its count in the top bar, not the name twice. */
  function samePageName() {
    const name = $('#page-name')
    name.hidden = name.textContent.trim().toLowerCase() === $('#canvas-title').textContent.trim().toLowerCase()
  }
  function updateSub() {
    const n = allFrames.size
    $('#canvas-sub').textContent = n ? `${n} screen${n === 1 ? '' : 's'}` : 'Whiteboard'
  }

  /** The page `#page=<id or title>` names, matched on its id or its title without regard to case. */
  function pageFromHash() {
    const m = /(?:^#|&)page=([^&]+)/.exec(location.hash)
    if (!m) return null
    let want = m[1]
    try { want = decodeURIComponent(want) } catch {}
    want = want.trim().toLowerCase()
    return pages().find((p) => p.id.toLowerCase() === want || String(p.title).trim().toLowerCase() === want)?.id ?? null
  }
  /** The screen `#screen=<file, key or name>` names, as Figma's link to a frame: the canvas opens on it. */
  function screenFromHash() {
    const m = /(?:^#|&)screen=([^&]+)/.exec(location.hash)
    if (!m) return null
    let want = m[1]
    try { want = decodeURIComponent(want) } catch {}
    return [...allFrames.values()].find((f) => f.key === want) ?? [...allFrames.values()].find((f) => f.file === want || f.label === want) ?? null
  }
  function goScreenFromHash() {
    const f = screenFromHash()
    if (!f) return false
    if (f.page && f.page !== pageId) goPage(f.page)
    showFrame(f)
    return true
  }
  /** The thread `#comment=<id>` names, as Figma's link to a comment: the canvas opens on it with the thread showing. Shared
   * comments can arrive after the page starts, so a link to one not yet loaded waits for the next refresh. */
  let linkedComment = null
  function goCommentFromHash() {
    const m = /(?:^#|&)comment=([^&]+)/.exec(location.hash)
    if (!m) return false
    let want = m[1]
    try { want = decodeURIComponent(want) } catch {}
    if (!threads.some((t) => t.id === want)) {
      linkedComment = want
      return false
    }
    linkedComment = null
    openThread(want, true)
    return true
  }
  /** FigJam's link to a selection: `#item=<id>[,<id>…]` opens the canvas on those board objects, on their page,
      selected and filling the view. */
  function goItemsFromHash() {
    const m = /(?:^#|&)item=([^&]+)/.exec(location.hash)
    if (!m) return false
    let ids = m[1]
    try { ids = decodeURIComponent(ids) } catch {}
    const list = ids.split(',').map((id) => board.items.find((i) => i.id === id)).filter(Boolean)
    if (!list.length) return hint('That part of the board is not here any more', 2400), false
    const pg = list[0].page ?? firstPage()
    if (pg !== pageId) goPage(pg)
    const here = list.filter((i) => (i.page ?? firstPage()) === pg).map((i) => i.id)
    here.length > 1 ? chooseItems(here) : pickItem(here[0])
    zoomToSelection()
    return true
  }
  async function copyItemsLink() {
    const ids = chosen ? [...chosen.items] : picked ? withGroup(picked) : []
    if (!ids.length) return
    const url = `${location.origin}${location.pathname}#item=${ids.map(encodeURIComponent).join(',')}`
    try {
      await navigator.clipboard.writeText(url)
      hint('Link copied. It opens the canvas on what is selected.', 1800)
    } catch {
      hint(url, 8000)
    }
  }
  addEventListener('hashchange', () => {
    if (goCommentFromHash()) return
    if (goItemsFromHash()) return
    if (goScreenFromHash()) return
    const id = pageFromHash()
    if (id) goPage(id)
  })

  // Pages: the switcher, each page's own menu, a new page.
  function goPage(id) {
    if (!pages().some((p) => p.id === id)) id = firstPage()
    if (id === pageId) return
    pageId = id
    store.set('page', id)
    picked = null
    renderPage()
    const saved = store.get(`view:${id}`)
    if (saved && Number.isFinite(saved.z)) {
      Object.assign(view, saved)
      apply()
    } else firstView()
  }
  $('#page-switch').addEventListener('click', (e) => {
    const anchor = e.currentTarget
    openMenu(anchor, [
      ...pages().map((p) => ({
        label: p.title, tick: p.id === pageId, keep: false, run: () => goPage(p.id),
        more: serve ? (btn) => openMenu(btn, [
          { label: 'Rename', run: async () => {
            const title = await question('Rename the page:', p.title)
            if (!title?.trim()) return
            try { await sendBoard({ op: 'page', id: p.id, title: title.trim() }); renderPage() } catch (err) { hint(err.message, 3000) }
          } },
          { label: 'Duplicate', run: () => duplicatePage(p) },
          { label: 'Move up', disabled: pages()[0]?.id === p.id, run: () => movePage(p.id, -1) },
          { label: 'Move down', disabled: pages().at(-1)?.id === p.id, run: () => movePage(p.id, 1) },
          { label: 'Delete', danger: true, disabled: pages().length < 2, run: async () => {
            if (!(await sure(`Delete the page "${p.title}"? Its frames stay in their files; the page is hidden.`, 'Delete', true))) return
            try { await sendBoard({ op: 'page', id: p.id, removed: true }); if (p.id === pageId) goPage(firstPage()); else renderPage() } catch (err) { hint(err.message, 3000) }
          } },
        ]) : null,
      })),
      serve ? '-' : null,
      serve ? { label: 'New page', run: async () => {
        const title = await question('Name the new page:', `Page ${pages().length + 1}`)
        if (!title?.trim()) return
        try {
          const ev = await sendBoard({ op: 'page', title: title.trim() })
          goPage(ev.id)
        } catch (err) { hint(err.message, 3000) }
      } } : null,
    ].filter(Boolean))
  })
  /** A new page after this one holding a copy of each of its board objects, at the same spots: groups and arrows
      between copied objects go with them. Frames stay with their files, and a guide with its frame. */
  async function duplicatePage(p) {
    const list = board.items.filter((i) => (i.page ?? firstPage()) === p.id && i.kind !== 'guide')
    try {
      const ev = await sendBoard({ op: 'page', title: `${p.title} copy` })
      const all = pages()
      const at = all.findIndex((x) => x.id === p.id)
      // Placed right after the page it copies.
      const order = [...all.filter((x) => x.id !== ev.id)]
      order.splice(at + 1, 0, all.find((x) => x.id === ev.id))
      await Promise.all(order.map((x, n) => (x.order === n ? null : sendBoard({ op: 'page', id: x.id, order: n }))))
      goPage(ev.id)
      if (list.length) await placeCopies(list, 0, 0)
      pickItem(null)
      hint(`${list.length} object${list.length === 1 ? '' : 's'} copied to ${p.title} copy`, 2000)
    } catch (err) {
      hint(err.message, 3000)
    }
  }
  /** A page one place up or down: every page is given its place in the new order, sent together, so one Ctrl+Z puts it back. */
  async function movePage(id, d) {
    const list = pages()
    const i = list.findIndex((p) => p.id === id)
    const j = i + d
    if (i < 0 || j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    try {
      await Promise.all(list.map((p, n) => (p.order === n ? null : sendBoard({ op: 'page', id: p.id, order: n }))))
      renderPage()
    } catch (err) {
      hint(err.message, 3000)
    }
  }
  /** The board objects selected, and the frames a drag box took, go to another page at the same spot. */
  async function moveSelectionToPage(page) {
    const list = selectedItems().filter((i) => !isLocked(i.id))
    const keys = chosen ? [...chosen.frames].filter((k) => !isLocked(k)) : []
    const title = pages().find((p) => p.id === page)?.title ?? 'that page'
    // A line or arrow joining what goes goes with it; one holding only one end of it lets go there, where it is drawn.
    const going = new Set([...list.map((i) => i.id), ...keys])
    // A locked line stays as it is.
    const bound = items().filter((i) => ['line', 'arrow'].includes(i.kind) && !going.has(i.id) && !isLocked(i.id) && ((i.from && going.has(i.from)) || (i.to && going.has(i.to))))
    const along = bound.filter((i) => (!i.from || going.has(i.from)) && (!i.to || going.has(i.to)))
    const letGo = bound.filter((i) => !along.includes(i))
    try {
      for (const it of letGo) {
        const g = geometryOf(it)
        // Only the end that went is let go; the other still holds what stays.
        await sendBoard({ op: 'item', id: it.id, x: g.x, y: g.y, w: g.w, h: g.h, points: g.points, from: it.from && going.has(it.from) ? '' : it.from ?? '', to: it.to && going.has(it.to) ? '' : it.to ?? '' })
      }
      await sendAll([...list, ...along].map((it) => ({ op: 'item', id: it.id, page })))
      for (const k of keys) {
        const f = allFrames.get(k)
        if (f) await sendBoard({ op: 'move', key: k, x: f.x, y: f.y, page })
      }
      pickItem(null)
      layoutAll()
      renderPage()
      hint(`Moved ${list.length + keys.length === 1 ? 'it' : list.length + keys.length} to ${title}`, 1600)
    } catch (err) {
      hint(err.message, 3000)
      takeBoardAgain()
    }
  }
  /** The bar's Page button: the other pages, to move what is selected onto. */
  const pageButton = () => (serve && pages().length > 1
    ? h('button', { type: 'button', class: 'tool', title: 'Move to another page', 'aria-haspopup': 'menu', onclick: (e) => openMenu(e.currentTarget, pages().filter((p) => p.id !== pageId).map((p) => ({ label: p.title, run: () => moveSelectionToPage(p.id) }))) }, 'Page', h('span', { class: 'caret' }, '▾'))
    : null)
  /** Put a frame on another page, at the same spot. */
  async function moveFrameToPage(f, page) {
    await sendBoard({ op: 'move', key: f.key, x: f.x, y: f.y, page })
    layoutAll()
    renderPage()
  }

  // Zoom menu.
  zoomLabel.addEventListener('click', (e) => openMenu(e.currentTarget, [
    { label: 'Zoom in', key: '+', run: () => zoomAt(view.z * 1.25, center().x, center().y) },
    { label: 'Zoom out', key: '−', run: () => zoomAt(view.z / 1.25, center().x, center().y) },
    '-',
    { label: 'Zoom to fit', key: 'F', run: fitAll },
    { label: '50%', run: () => zoomAt(0.5, center().x, center().y) },
    { label: '100%', key: '0', run: () => zoomAt(1, center().x, center().y) },
    { label: '200%', run: () => zoomAt(2, center().x, center().y) },
  ]))

  // ── the panel ──
  function setPanel(on) {
    document.body.classList.toggle('panel-open', on)
    $('#tool-panel').setAttribute('aria-pressed', String(on))
    store.set('panel', on)
    call('onPanel', on)
  }
  function openPanel(tab) {
    for (const b of document.querySelectorAll('#panel [role=tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab))
    for (const s of document.querySelectorAll('#panel .tab-body')) s.hidden = s.dataset.body !== tab
    store.set('tab', tab)
    $('#tool-comments').setAttribute('aria-pressed', String(tab === 'comments' && document.body.classList.contains('panel-open')))
    setPanel(true)
    $('#tool-comments').setAttribute('aria-pressed', String(tab === 'comments'))
    if (tab === 'comments' && document.body.classList.contains('pins-off')) setPinsShown(true, true)
    call('onTab', tab)
  }
  const currentTab = () => document.querySelector('#panel [role=tab][aria-selected=true]')?.dataset.tab ?? 'properties'
  for (const b of document.querySelectorAll('#panel [role=tab]')) b.addEventListener('click', () => openPanel(b.dataset.tab))
  $('#panel-close').addEventListener('click', () => { setPanel(false); $('#tool-comments').setAttribute('aria-pressed', 'false') })
  $('#tool-panel').addEventListener('click', () => {
    if (document.body.classList.contains('panel-open')) {
      setPanel(false)
      $('#tool-comments').setAttribute('aria-pressed', 'false')
    } else openPanel(currentTab() === 'comments' ? 'properties' : currentTab())
  })
  $('#tool-comments').addEventListener('click', () => {
    if (document.body.classList.contains('panel-open') && currentTab() === 'comments') {
      setPanel(false)
      $('#tool-comments').setAttribute('aria-pressed', 'false')
    } else openPanel('comments')
  })
  $('#show-resolved').addEventListener('change', renderPins)
  $('#comment-search').addEventListener('input', renderList)
  // Figma's Mark all as read: every thread's dot goes at once.
  $('#mark-read').addEventListener('click', () => { for (const t of threads) markSeen(t); renderPins() })
  $('#comment-search').addEventListener('keydown', (e) => e.stopPropagation())
  for (const id of ['#only-mine', '#comment-sort']) $(id).addEventListener('change', () => { store.set(id.slice(1), id === '#only-mine' ? $(id).checked : $(id).value); renderList() })
  $('#only-mine').checked = !!store.get('only-mine')
  $('#comment-sort').value = store.get('comment-sort') || 'number'
  $('#my-name').addEventListener('change', (e) => setName(e.target.value))

  // ── hints ──
  const hintEl = $('#hint')
  let hintTimer = 0
  function hint(text, ms = 1600) {
    hintEl.textContent = text
    hintEl.classList.add('show')
    clearTimeout(hintTimer)
    hintTimer = setTimeout(() => hintEl.classList.remove('show'), ms)
  }

  // ── keys ──
  // A tool that cannot work where the canvas is open is hidden, and its key does nothing.
  const usable = (t) => (t === 'select' || t === 'hand' ? true : t === 'comment' ? !!api : serve)
  const TOOL_KEYS = { v: 'select', h: 'hand', t: 'text', a: 'artboard', n: 'note', p: 'pencil', e: 'stamp', c: 'comment' }
  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')) return
    if (play.classList.contains('open')) return playKey(e)
    // An open menu takes Escape first, opened by mouse or keyboard: it closes, and nothing under it moves.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      return openFind()
    }
    // Ctrl+= and Ctrl+− zoom the board, Ctrl+0 to 100%, as in Figma: never the browser's zoom of the whole page.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && ['=', '+', '-', '_', '0'].includes(e.key)) {
      e.preventDefault()
      if (e.key === '0') return zoomAt(1, center().x, center().y)
      return zoomAt(view.z * (e.key === '-' || e.key === '_' ? 0.8 : 1.25), center().x, center().y)
    }
    if (e.key === 'Escape' && menu.classList.contains('open')) {
      e.preventDefault()
      return closeMenu(true)
    }
    if (call('onKey', e)) return
    // Figma's Show/Hide UI (Ctrl+Shift+\ here, since Ctrl+\ is the panel): the board alone, to present or share it.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === 'Backslash') {
      e.preventDefault()
      return setBarsShown(document.body.classList.contains('ui-off'))
    }
    // Figma's multiplayer cursors (Ctrl+Alt+\): other people's pointers hidden or shown again.
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.code === 'Backslash') {
      e.preventDefault()
      return setPointersShown(document.body.classList.contains('pointers-off'))
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
      e.preventDefault()
      return $('#tool-panel').click()
    }
    if (e.key === ' ' && !spaceHeld) {
      spaceHeld = true
      document.body.classList.add('space')
      e.preventDefault()
      return
    }
    // Ctrl+A on the board: every object and frame on the page.
    if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && e.code === 'KeyA' && selectedItems().length && !call('selectedFile')) {
      e.preventDefault()
      return selectMatching()
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a' && serve) {
      e.preventDefault()
      const ids = board.items.filter((i) => (i.page ?? firstPage()) === pageId && i.kind !== 'guide').map((i) => i.id)
      return chooseItems(ids, frames().map((f) => f.key))
    }
    // Figma's Select inverse (Ctrl+Shift+A) on the board: every object and screen on the page that isn't selected.
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === 'KeyA' && serve && (!call('selectedFile') || call('selectedScreen'))) {
      e.preventDefault()
      const screen = call('selectedScreen')
      const have = new Set([...selectedItems().map((i) => i.id), ...(chosen ? chosen.frames : []), ...(screen ? [screen] : [])])
      const ids = board.items.filter((i) => (i.page ?? firstPage()) === pageId && i.kind !== 'guide' && !have.has(i.id)).map((i) => i.id)
      const keys = frames().map((f) => f.key).filter((k) => !have.has(k))
      if (!ids.length && !keys.length) return hint('Everything on the page is already selected', 1600)
      return chooseItems(ids, keys)
    }
    if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && e.code === 'KeyG' && serve && selectedItems().length + (chosen?.frames.size ?? 0) && !call('selectedFile')) {
      e.preventDefault()
      return sectionAround()
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g' && chosen?.items.size && serve) {
      e.preventDefault()
      return groupChosen(!e.shiftKey)
    }
    // Figma's Lock (Ctrl+Shift+L) for what is selected on the board: all locked, or all unlocked when all were.
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && serve && e.key.toLowerCase() === 'l' && !call('selectedFile')) {
      const keys = chosen ? [...chosen.items, ...chosen.frames] : picked ? withGroup(picked) : []
      if (keys.length) {
        e.preventDefault()
        if (!owner()) return hint('Only the owner can lock things.', 1600)
        return setLock(keys, !keys.every(isLocked))
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && serve && e.key.toLowerCase() === 'v' && boardClip && !call('selectedFile')) {
      e.preventDefault()
      return pasteInPlace()
    }
    // With nothing copied or selected, Ctrl+Shift+R is left to the browser (a reload).
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && serve && e.code === 'KeyR' && boardClip && selectedItems().length && !call('selectedFile')) {
      e.preventDefault()
      return pasteReplace()
    }
    // Ctrl+] and Ctrl+[ one place up or down the stack, with Shift to the front or back (by the key's place, since
    // Shift changes what a bracket key types).
    if ((e.metaKey || e.ctrlKey) && !e.altKey && serve && (e.code === 'BracketRight' || e.code === 'BracketLeft') && selectedItems().length) {
      e.preventDefault()
      return e.shiftKey ? restack(e.code === 'BracketRight') : restep(e.code === 'BracketRight')
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && serve) {
      const k = e.key.toLowerCase()
      const screens = k === 'd' && chosen?.frames.size ? frames().filter((f) => chosen.frames.has(f.key)) : []
      const done = k === 'd' ? (selectedItems().length || screens.length ? (selectedItems().length && duplicateItems(), screens.length && duplicateScreens(screens), true) : false) : k === 'c' ? copyItems() : k === 'x' ? cutItems() : k === 'v' ? !call('selectedFile') && pasteItems() : false
      if (done) return e.preventDefault()
    }
    // Figma's align keys, by the key's place so a Mac's Option characters do not matter.
    if (e.altKey && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyT' && serve && chosen?.items.size > 1) {
      e.preventDefault()
      return tidyChosen()
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && serve && chosen?.items.size > 1) {
      const how = e.shiftKey ? { KeyH: 'x', KeyV: 'y' }[e.code] : { KeyA: 'left', KeyH: 'center', KeyD: 'right', KeyW: 'top', KeyV: 'middle', KeyS: 'bottom' }[e.code]
      if (how) {
        e.preventDefault()
        return e.shiftKey ? distributeChosen(how) : alignChosen(how)
      }
    }
    // Copy as PNG, for board objects.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === 'KeyC' && selectedItems().length && !call('selectedFile')) {
      e.preventDefault()
      return copyBoardPng()
    }
    // Outlines on or off.
    if (e.altKey && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyO') {
      e.preventDefault()
      return setOutlines(!outlinesOn)
    }
    // Figma's Collapse layers.
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyL' && window.designCanvas?.collapseLayers) {
      e.preventDefault()
      window.designCanvas.collapseLayers()
      return hint('Layers collapsed', 1000)
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === '?') {
      e.preventDefault()
      return openKeys()
    }
    // Figma's cursor chat: / and a few words, shown by this pointer to everyone else here.
    if (e.key === '/' && roomUrl()) {
      e.preventDefault()
      return openChat()
    }
    if (e.key === 'Tab' && picked && !chosen) {
      e.preventDefault()
      return tabItem(e.shiftKey ? -1 : 1)
    }
    // Figma's Enter on a picked note, shape, title, section or line: typing in it starts, its words all selected.
    if (e.key === 'Enter' && !e.shiftKey && picked && !chosen && serve) {
      e.preventDefault()
      return editItemText(picked)
    }
    if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault()
      return stepScreen(e.key === 'PageDown' ? 1 : -1)
    }
    const k = e.key.toLowerCase()
    if (e.key === 'Escape') {
      if (menu.classList.contains('open')) closeMenu(true)
      else if (ask.classList.contains('open')) closeAsk()
      else if (thread.classList.contains('open')) closeThread()
      else if (picked || chosen) pickItem(null)
      else setTool('select')
    } else if (e.key.startsWith('Arrow') && serve && (picked || chosen)) {
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      nudgeBoard(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0)
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && chosen?.items.size) {
      removeChosen()
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && picked) {
      removeItem(picked)
    } else if (e.shiftKey && (k === 'h' || k === 'v') && serve && selectedItems().length && !call('selectedFile')) {
      flipChosen(k === 'h' ? 'x' : 'y')
    } else if (e.shiftKey && k === 'c') {
      setPinsShown(document.body.classList.contains('pins-off'))
    } else if (TOOL_KEYS[k]) {
      if (usable(TOOL_KEYS[k])) setTool(TOOL_KEYS[k])
    // Figma's shape keys: R the rectangle, O the ellipse, L the line, Shift+L the arrow, S a section.
    } else if (k === 'r' && serve) setShape('rect')
    else if (k === 'o' && serve) setShape('ellipse')
    else if (k === 'l' && serve) setShape(e.shiftKey ? 'arrow' : 'line')
    else if (k === 's' && serve) setShape('section')
    else if (k === 'f' || (e.key === '!' && e.shiftKey)) fitAll()
    else if (e.shiftKey && e.code === 'Digit2') zoomToSelection()
    else if (e.key === '=' || e.key === '+') zoomAt(view.z * 1.25, center().x, center().y)
    else if (e.key === '-') zoomAt(view.z / 1.25, center().x, center().y)
    // 0, and Figma's Shift+0 (by the key's place, since Shift changes what it types): 100%.
    else if (e.key === '0' || (e.shiftKey && e.code === 'Digit0')) zoomAt(1, center().x, center().y)
    else return
    e.preventDefault()
  })
  addEventListener('keyup', (e) => {
    if (e.key === ' ') {
      spaceHeld = false
      document.body.classList.remove('space')
    }
  })
  addEventListener('resize', () => { placeThread(); loadVisible(); placeItemBar(); call('onView'); if (playing) setPlayWidth(playWidth) })

  /** A prototype changed by something else (an agent, a build script): redraw it everywhere. */
  async function fileChanged(file, { quiet = false } = {}) {
    try {
      const res = await fetch(`/api/file?f=${encodeURIComponent(file)}`, { cache: 'no-store' })
      const body = await res.json()
      if (res.ok) {
        const drawn = reloadFile(file, body.html)
        if (quiet) return
        call('onOutsideChange', file)
        hint(drawn ? `${file} changed outside the canvas; redrawn` : `${file} changed outside the canvas; it redraws when you finish typing`, drawn ? 2000 : 3000)
      }
    } catch {}
  }
  /** Someone else changed the board: take its lines again. Not mid-drag or mid-typing; the next change brings it. */
  async function refreshBoard() {
    if (drag || document.querySelector('.items .editing')) return
    // Lines of this page's own still being saved: the server's board would undo what is drawn here ahead of them
    // (a group half written); it is read again once they are all saved.
    if (pending) return (boardMissed = true)
    try {
      const res = await fetch('/api/board', { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok || !Array.isArray(body.events) || body.events.length === boardEvents.length) return
      boardEvents = body.events
      board = foldPlaced(boardEvents)
      // The canvas's name is a board line too: a rename made elsewhere, or kept by a visitor's browser, shows.
      setTitle()
      relayout()
    } catch {}
  }
  // ── the server's news ──
  if (serve) {
    try {
      const stream = new EventSource('/api/stream')
      // A file someone changed: one changed outside the canvas says so; another person's edit redraws quietly; this
      // page's own is already drawn.
      stream.addEventListener('file', (e) => {
        const d = JSON.parse(e.data)
        if (d.by !== tabId) fileChanged(d.file, { quiet: d.by != null })
      })
      stream.addEventListener('lines', refresh)
      stream.addEventListener('board', refreshBoard)
      stream.addEventListener('sheet', (e) => { const { sheet, text } = JSON.parse(e.data); reloadSheet(sheet, text) })
      stream.addEventListener('reload', () => location.reload())
    } catch {}
  }

  /** Editing switched on without a server: local.js answers /api/ itself from the folder it was given. */
  function enableLocal(folderName, title = 'Edits and comments are written into this folder by the page itself', asVisitor = false) {
    serve = true
    visitor = asVisitor
    api = '/api/canvas-comments'
    local = true
    document.body.classList.add('serving', 'commenting')
    $('#canvas-mode').textContent = `Editing ${folderName}`
    $('#canvas-mode').title = title
    // Editing live through the room says so, whichever came first.
    if (remote) showRemote()
    showEmpty()
    for (const file of Object.keys(data.files)) {
      delete fileHtml[file]
      for (const f of allFrames.values()) if (f.file === file && f.loaded && f.el) loadFrame(f)
    }
    refresh()
    renderPins()
    drawLocks()
  }

  // ── what the editor works through ──
  window.designCanvas = {
    boardUndo, noteFileEdit,
    get serve() { return serve },
    get local() { return local },
    get owner() { return owner() },
    get commenting() { return !!api },
    data, web, hooks, h, icon, store, hint, readOnly, fileChanged, enableLocal, refreshBoard, isLocked, relayoutAll: () => { layoutAll(); renderPage() },
    get view() { return view },
    get tool() { return tool },
    get page() { return pageId },
    get me() { return me },
    get frames() { return frames() },
    get allFrames() { return [...allFrames.values()] },
    get items() { return items() },
    get chosen() { return chosen && { box: chosen.box, items: [...chosen.items], frames: [...chosen.frames] } },
    get picked() { return picked },
    choose, geometryOf,
    get pages() { return pages() },
    get threads() { return threads },
    overlay, viewport, world,
    toWorld, toScreen, frameAt, shootBoard, findFrame, showFrame, docFor, plainFile, reloadFile, reloadSheet, duplicateScreens, setFrameWidth, schemeOf, setScheme, ARTBOARD_SIZES, relayout, downloadFile,
    setTool, openPanel, setPanel, currentTab, nudgeScreen, openMenu, closeMenu, question, sure, openPlay, goPage, moveFrameToPage,
    startComment, commentOn, openAsk, renderPins, pickItem, apply, sendBoard, showEmpty,
    setName: (n) => setName(n),
    store,
  }

  // ── start ──
  // Links the layout names (the project's home, its repository) sit at the right of the top bar.
  for (const link of [...(data.links ?? [])].reverse()) {
    if (/^https?:\/\//i.test(link?.href ?? '') && link.text) $('#bar-right').prepend(h('a', { class: 'tool link', href: link.href, target: '_blank', rel: 'noopener' }, String(link.text)))
  }
  document.body.classList.toggle('serving', serve)
  document.body.classList.toggle('commenting', !!api)
  $('#canvas-mode').textContent = serve ? (data.memory ? 'Editing (held in memory)' : 'Editing') : 'Viewing'
  $('#canvas-mode').title = serve ? 'Served: edits are written into the prototypes' : readOnly
  $('#my-name').value = me
  setShape(shapeKind)
  setTool('select')
  // The page is drawn once the lines after this script are parsed and the editor has hooked in.
  const start = () => {
    const script = document.currentScript ?? document.scripts[document.scripts.length - 1]
    const after = []
    for (let n = document.querySelector('#rc-data ~ script')?.nextSibling ?? script?.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType === Node.COMMENT_NODE) after.push(`<!--${n.data}-->`)
    }
    asBuilt = asBuilt.replace(/<\/body>\s*<\/html>\s*$/, `${after.join('\n')}\n</body>\n</html>\n`)
    boardEvents = ownLines('board')
    board = foldPlaced(boardEvents)
    editLines = ownLines('edit')
    events = ownLines('comment')
    threads = foldEvents(events)
    setTitle()
    layoutAll()
    // A link may name the page it opens on, #page=<id or title>, ahead of the one last viewed here.
    const linked = pageFromHash()
    pageId = linked ?? (pages().some((p) => p.id === store.get('page')) ? store.get('page') : firstPage())
    renderPage()
    const saved = linked ? null : store.get(`view:${pageId}`)
    if (saved && Number.isFinite(saved.z)) {
      Object.assign(view, saved)
      apply()
    } else firstView()
    goScreenFromHash()
    goItemsFromHash()
    goCommentFromHash()
    if (store.get('pins-off')) document.body.classList.add('pins-off')
    const tab = store.get('tab')
    if (store.get('panel')) openPanel(tab || 'properties')
    refresh()
    joinRoom()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else queueMicrotask(start)
  setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 20000)
  addEventListener('focus', refresh)
})()
