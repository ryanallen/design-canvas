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
    rect: '<rect x="2.5" y="3.5" width="11" height="9" rx="1"/>',
    ellipse: '<ellipse cx="8" cy="8" rx="5.8" ry="4.8"/>',
    line: '<path d="M3 13L13 3" stroke-linecap="round"/>',
    arrow: '<path d="M3 13L13 3M7 3h6v6" stroke-linecap="round" stroke-linejoin="round"/>',
    guide: '<path d="M2.5 2.5h11v11h-11z M6 2.5v11 M10 2.5v11" stroke-linejoin="round"/>',
    section: '<path d="M2.5 5.5h11v8h-11z M2.5 5.5v-3h5v3" stroke-linejoin="round"/>',
    comment: '<path d="M3 3h10v7H7l-3 3v-3H3z" stroke-linejoin="round"/>',
    panel: '<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M10 2.5v11"/>',
    download: '<path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10" stroke-linecap="round" stroke-linejoin="round"/>',
    full: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" stroke-linecap="round" stroke-linejoin="round"/>',
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
  let board = foldBoard(boardEvents)
  let editLines = []

  // ── files: each prototype is stored once and written into its frames as srcdoc ──
  // Not a blob URL: a page opened from disk may not frame its own blobs in Chrome, and srcdoc
  // works the same from a disk or a server. A shared stylesheet goes in as a <style>.
  const fileHtml = {}
  const withAssets = (file) => {
    if (!fileHtml[file]) {
      fileHtml[file] = data.files[file].replace(/<link\b[^>]*__RC_ASSET__\(([^)]+)\)[^>]*>/g, (_, a) => (data.assets[a] ? `<style>${data.assets[a].text}</style>` : ''))
    }
    return fileHtml[file]
  }
  /** The prototype as a file of its own: what Download gives, with nothing the canvas added. */
  const plainFile = (file) => withAssets(file).replace(/\s+data-cv="\d+"/g, '')
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
    const at = html.search(/<\/head>/i)
    return at < 0 ? go + cut + html : html.slice(0, at) + go + cut + html.slice(at)
  }
  const save = (name, text, type = 'text/html') => {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name })
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
      if (known) Object.assign(known, p.title ? { title: p.title } : {}, p.removed != null ? { removed: p.removed } : {})
      else list.push({ id: p.id, title: p.title || 'Untitled', sections: [], removed: !!p.removed })
    }
    return list.filter((p) => !p.removed)
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

  function renderPage() {
    for (const f of allFrames.values()) {
      f.el?.remove()
      f.labelEl?.remove()
      f.el = f.labelEl = f.iframe = null
      f.loaded = false
    }
    world.replaceChildren()
    sectionEls = []
    drawGroups()
    world.append(sectionLayer)
    for (const f of frames()) drawFrame(f)
    world.append(itemLayer, pinLayer)
    renderItems()
    renderPins()
    $('#page-name').textContent = pages().find((p) => p.id === pageId)?.title ?? ''
    $('#page-count').textContent = String(pages().length)
    samePageName()
    stackLabels()
    updateSub()
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
      h('button', { type: 'button', title: 'Download this prototype', onclick: (e) => { e.stopPropagation(); downloadFile(f.file) } }, icon('download')),
      h('button', { type: 'button', title: 'Full screen', onclick: (e) => { e.stopPropagation(); openPlay(f, 'fill') } }, icon('full')),
      m.levers?.length ? h('button', { type: 'button', title: 'Tweaks', onclick: (e) => { e.stopPropagation(); call('onTweaks', f); openPanel('tweaks') } }, icon('tweaks')) : null,
      m.play ? h('button', { type: 'button', class: 'play', title: 'Play it: click through it at full size', onclick: (e) => { e.stopPropagation(); openPlay(f) } }, '▷ PLAY') : null,
    )
    f.labelEl.addEventListener('pointerdown', (e) => startFrameDrag(e, f))
    drawLock(f)
    positionFrame(f)
    world.append(f.el, f.labelEl)
  }
  function positionFrame(f) {
    if (!f.el) return
    Object.assign(f.el.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.W}px`, height: `${f.H}px` })
    Object.assign(f.labelEl.style, { left: `${f.x}px`, top: `${f.y}px` })
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
      any ||= stack
    }
    document.body.classList.toggle('labels-stacked', any)
  }
  function apply() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`
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
  /** Go to a frame on the board: its page, then the frame filling the window. */
  function showFrame(f) {
    if (f.page !== pageId) goPage(f.page)
    fitTo({ x: f.x, y: f.y, w: f.W, h: f.H })
  }
  const centre = () => ({ x: (viewport.clientWidth - panelWidth()) / 2, y: viewport.clientHeight / 2 })

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
      // An edit that makes the page taller or shorter makes the frame follow.
      if (serve && !f.crop && f.doc?.documentElement) {
        const tall = Math.min(MAX_H, Math.max(MIN_H, Math.ceil(f.doc.documentElement.scrollHeight)))
        if (Math.abs(tall - f.h) > 4 && !f.hash) {
          heights[f.key] = tall
          relayout()
        }
      }
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
  function reloadFile(file, html) {
    data.files[file] = html
    delete fileHtml[file]
    for (const f of allFrames.values()) if (f.file === file && f.loaded && f.el) loadFrame(f)
    if (playing?.file === file) playFrame.srcdoc = docFor(playing)
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
  const DRAW = ['note', 'rect', 'ellipse', 'section', 'line', 'arrow', 'pencil', 'artboard']
  const SHAPES = ['rect', 'ellipse', 'section', 'line', 'arrow', 'guide']
  function setTool(t) {
    tool = t
    document.body.className = document.body.className.replace(/\btool-\S+/g, '').trim()
    document.body.classList.add(`tool-${t}`)
    for (const b of document.querySelectorAll('#toolbar [data-tool]')) {
      const on = b.dataset.tool === t || (b.id === 'shape-tool' && SHAPES.includes(t))
      b.setAttribute('aria-pressed', String(on))
    }
    if (t !== 'comment' && draft) closeThread()
    if (t !== 'select') pickItem(null)
    call('onTool', t)
  }
  const SHAPE_NAMES = { rect: 'Rectangle (R)', ellipse: 'Ellipse', section: 'Section (S)', line: 'Line', arrow: 'Arrow', guide: 'Layout guide' }
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
    if (!panning && e.button === 0) {
      if (call('onPointerDown', e, { frame: f, point: p, tool, item: itemEl?.dataset.id ?? null })) return
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
    const itemEl = e.target.closest('.item') ?? document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.matches('.item:not(.guide)'))
    if (itemEl && tool === 'select') return editItemText(itemEl.dataset.id)
    call('onDblClick', e, { frame: frameAt(e.clientX, e.clientY), point: toWorld(e.clientX, e.clientY) })
  })
  viewport.addEventListener('pointerleave', () => call('onHover', null, null))

  // A frame is moved by its header; it lands as a `move` line and stays where it was put.
  function startFrameDrag(e, f) {
    if (e.button !== 0 || e.target.closest('button') || !serve) return
    e.stopPropagation()
    const x0 = f.x
    const y0 = f.y
    drag = {
      kind: 'frame', id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false,
      move: (_, dx, dy) => {
        if (isLocked(f.key)) return
        f.x = Math.round(x0 + dx)
        f.y = Math.round(y0 + dy)
        positionFrame(f)
        renderItems()
        renderPins()
        call('onView')
      },
      end: (_, moved) => {
        if (!moved) return call('onFramePick', f)
        if (isLocked(f.key)) return hint(LOCKED, 2000)
        sendBoard({ op: 'move', key: f.key, x: f.x, y: f.y, page: pageId }).catch((err) => { hint(err.message, 3000); takeBoardAgain() })
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
    '#8a8a96': 'Grey', '#3b82f6': 'Blue', '#a855f7': 'Purple', '#ec4899': 'Pink', '#22c55e': 'Green', '#f59e0b': 'Amber', '#ef4444': 'Red', '#ffffff': 'White',
  }
  let picked = null
  // What a drag box took in: board objects and frames, and the box itself.
  let chosen = null
  const items = () => board.items.filter((i) => (i.page ?? firstPage()) === pageId)
  // Redrawing removes a note being typed in, whose blur saves it and asks for another redraw:
  // that one waits until this one is done.
  let drawingItems = false
  let itemsAgain = false
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
      if (chosen) {
        // Drawn round what is chosen as it is now, so it follows a drag.
        const b = boxAround([...chosen.items], [...chosen.frames])
        const members = [...chosen.items].map((id) => board.items.find((i) => i.id === id))
        const grouped = members.length > 1 && members.every((i) => i?.group && i.group === members[0].group)
        itemLayer.append(h('div', { class: `chosen-box${grouped ? ' grouped' : ''}`, style: `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px` }))
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
  }
  /** A page with nothing on it says, once, in one quiet line, what can be done with it from here. */
  function showEmpty() {
    const el = $('#empty')
    if (!el) return
    const empty = !frames().length && !items().length
    el.hidden = !empty
    if (!empty) return
    const edit = !serve && document.querySelector('button#canvas-mode:not(:disabled)')
    el.replaceChildren(
      h('b', {}, 'An empty board'),
      serve ? h('span', {}, 'Pick a tool below to add text, notes, drawings and shapes.')
        : edit ? h('span', {}, h('button', { type: 'button', onclick: () => edit.click() }, 'Edit'), ' and pick this folder to draw on it.')
          : h('span', {}, 'Nothing has been put on this page yet.'))
  }
  // ── arrows that hold on: an end bound to an object or a frame is drawn at that one's edge ──
  const BINDS = ['note', 'rect', 'ellipse', 'section']
  /** The box a `from` or `to` names on this page: a board object's, or a frame's. */
  function boxOfRef(ref) {
    if (!ref) return null
    const it = board.items.find((i) => i.id === ref)
    if (it) return BINDS.includes(it.kind) && (it.page ?? firstPage()) === pageId ? { x: it.x, y: it.y, w: it.w ?? 0, h: it.h ?? 0 } : null
    const f = allFrames.get(ref)
    return f && f.page === pageId ? { x: f.x, y: f.y, w: f.W, h: f.H } : null
  }
  /** Where the line from a box's centre towards a point leaves the box. */
  function edgeToward(b, p) {
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    const dx = p.x - cx
    const dy = p.y - cy
    if (!dx && !dy) return { x: cx, y: cy }
    const t = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity)
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
    const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
    if (A && B) {
      a = edgeToward(A, centre(B))
      b = edgeToward(B, centre(A))
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

  // A colour is a hex, a name or rgb()/hsl() numbers, nothing else: a colour from a canvas file
  // goes into a style, and a style may not fetch (url()) or break out of its declaration.
  const safeColor = (c) => (typeof c === 'string' && /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(?:rgb|hsl)a?\([\d.,%\s/]+\))$/i.test(c.trim()) ? c.trim() : '')
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  function itemEl(it) {
    it = geometryOf(it)
    it = { ...it, color: safeColor(it.color), x: num(it.x), y: num(it.y), w: num(it.w), h: num(it.h) }
    const cls = `item ${it.kind}${picked === it.id || chosen?.items.has(it.id) ? ' on' : ''}${isLocked(it.id) ? ' locked' : ''}`
    const box = `left:${it.x}px;top:${it.y}px;width:${it.w ?? 0}px;height:${it.h ?? 0}px`
    // The one object picked shows where it resizes from: its bottom-right corner.
    const grip = serve && picked === it.id && !chosen && !isLocked(it.id) && ['note', 'rect', 'ellipse', 'section'].includes(it.kind) ? h('span', { class: 'grip', 'aria-hidden': 'true' }) : null
    if (it.kind === 'note') return h('div', { class: cls, 'data-id': it.id, style: `${box};background:${it.color || NOTE_COLORS[0]}` }, it.text ?? '', grip)
    if (it.kind === 'title') return h('div', { class: cls, 'data-id': it.id, style: `left:${it.x}px;top:${it.y}px;${it.color ? `color:${it.color}` : ''}` }, it.text || 'Title')
    if (it.kind === 'rect' || it.kind === 'ellipse') return h('div', { class: cls, 'data-id': it.id, style: `${box};--c:${it.color || SHAPE_COLORS[0]}` }, h('span', { class: 'txt' }, it.text ?? ''), grip)
    if (it.kind === 'section') return h('div', { class: cls, 'data-id': it.id, style: `${box};--c:${it.color || SECTION_COLORS[0]}` }, h('span', { class: 'txt' }, it.text ?? ''), grip)
    if (it.kind === 'guide') {
      const f = findFrame(it.frame)
      if (!f || f.page !== pageId) return null
      const cols = Math.min(48, Math.max(1, Math.round(num(it.cols)) || 12))
      const m = num(it.margin ?? 80) * f.s
      const g = num(it.gutter ?? 24) * f.s
      return h('div', { class: `item guide`, 'data-id': it.id, style: `left:${f.x + m}px;top:${f.y}px;width:${f.W - m * 2}px;height:${f.H}px;grid-template-columns:repeat(${cols},1fr);column-gap:${g}px` }, ...Array.from({ length: cols }, () => h('span'))
      )
    }
    if (['line', 'arrow', 'pencil'].includes(it.kind)) {
      // Built as elements, never as markup: a canvas file's lines are anyone's, so nothing in one is parsed as HTML.
      const pts = (Array.isArray(it.points) ? it.points : []).map(Number).filter(Number.isFinite)
      const d = pts.reduce((s, v, i) => s + (i % 2 ? `,${v}` : `${i ? ' L' : 'M'}${v}`), '')
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
        s('path', { class: 'ink', d, fill: 'none', stroke: color, 'stroke-width': it.kind === 'pencil' ? 5 : 4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'marker-end': it.kind === 'arrow' ? `url(#${markerId})` : null }),
        s('path', { class: 'hit', d, fill: 'none', stroke: 'transparent', 'stroke-width': 24 }),
      )
      return h('div', { class: `${cls} svg`, 'data-id': it.id, style: box }, svg)
    }
    return null
  }
  // A board object's own bar: its colours and delete, above it while it is picked.
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
  // ── groups: board objects that share a group id are picked, moved, coloured and deleted as one ──
  const groupMembers = (gid) => (gid ? items().filter((i) => i.group === gid).map((i) => i.id) : [])
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
    if (on && ids.length < 2) return hint('Select two or more board objects to group them', 2000)
    const gid = on ? newGroupId() : ''
    const change = ids.filter((id) => on || board.items.find((i) => i.id === id)?.group)
    if (!change.length) return hint('Nothing selected is in a group', 1600)
    for (const id of change) Object.assign(board.items.find((i) => i.id === id), { group: gid })
    renderItems()
    try {
      for (const id of change) await sendBoard({ op: 'item', id, group: gid })
      hint(on ? `Grouped ${change.length}: they now move, colour and delete as one` : 'Ungrouped', 1600)
    } catch (err) {
      hint(err.message, 3000)
      takeBoardAgain()
    }
  }
  // ── duplicate, copy and paste ──
  let boardClip = null // { items, times }
  /** What is selected on the board: a drag box's or Shift's objects, or the one picked with its group. */
  const selectedItems = () => (chosen ? [...chosen.items] : picked ? withGroup(picked) : []).map((id) => board.items.find((i) => i.id === id)).filter((i) => i && i.kind !== 'guide')
  const COPIED = ['kind', 'x', 'y', 'w', 'h', 'text', 'color', 'points', 'from', 'to', 'group']
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
    return made
  }
  const duplicateItems = () => {
    const list = selectedItems()
    if (list.length) placeCopies(list, 24, 24)
  }
  function copyItems() {
    const list = selectedItems()
    if (!list.length) return false
    boardClip = { items: list.map((i) => ({ ...i })), times: 0 }
    hint(`Copied ${list.length === 1 ? 'it' : list.length}`, 900)
    return true
  }
  function pasteItems() {
    if (!boardClip) return false
    boardClip.times++
    placeCopies(boardClip.items, 24 * boardClip.times, 24 * boardClip.times)
    return true
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
      for (const it of list) await sendBoard({ op: 'item', id: it.id, z: it.z })
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
    if (chosen) chosen.box = boxAround([...chosen.items], [...chosen.frames])
    renderItems()
    try {
      for (const s of sends) await sendBoard(s)
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
      dx: how === 'left' ? all.x - b.x : how === 'centre' ? all.x + all.w / 2 - (b.x + b.w / 2) : how === 'right' ? all.x + all.w - (b.x + b.w) : 0,
      dy: how === 'top' ? all.y - b.y : how === 'middle' ? all.y + all.h / 2 - (b.y + b.h / 2) : how === 'bottom' ? all.y + all.h - (b.y + b.h) : 0,
    })))
  }
  /** Equal gaps between neighbours across (x) or down (y), the first and last staying where they are. */
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
  function alignMenu(anchor) {
    const n = selectedUnits().length
    openMenu(anchor, [
      { label: 'Align left', key: 'Alt+A', run: () => alignChosen('left') },
      { label: 'Align centres', key: 'Alt+H', run: () => alignChosen('centre') },
      { label: 'Align right', key: 'Alt+D', run: () => alignChosen('right') },
      '-',
      { label: 'Align top', key: 'Alt+W', run: () => alignChosen('top') },
      { label: 'Align middles', key: 'Alt+V', run: () => alignChosen('middle') },
      { label: 'Align bottom', key: 'Alt+S', run: () => alignChosen('bottom') },
      ...(n >= 3 ? ['-', { label: 'Space evenly across', key: 'Alt+Shift+H', run: () => distributeChosen('x') }, { label: 'Space evenly down', key: 'Alt+Shift+V', run: () => distributeChosen('y') }] : []),
    ])
  }
  /** One colour for every selected object that takes one. */
  async function colorChosen(color) {
    const ids = [...(chosen?.items ?? [])].filter((id) => !isLocked(id) && board.items.find((i) => i.id === id)?.kind !== 'guide')
    for (const id of ids) Object.assign(board.items.find((i) => i.id === id), { color })
    renderItems()
    try {
      for (const id of ids) await sendBoard({ op: 'item', id, color })
    } catch (err) {
      hint(err.message, 3000)
      takeBoardAgain()
    }
  }
  async function removeChosen() {
    const all = [...(chosen?.items ?? [])]
    const ids = all.filter((id) => !isLocked(id))
    if (ids.length < all.length) hint(`${all.length - ids.length} locked, left where they are`, 2400)
    chosen = null
    try {
      for (const id of ids) await sendBoard({ op: 'remove', id })
    } catch (err) {
      hint(err.message, 3000)
    }
    renderItems()
  }
  // A drag box: from empty board, with the select tool, while editing.
  function startMarquee(e, p) {
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
        if (!moved) return emptyClick(ev)
        choose(box())
      },
    }
    viewport.setPointerCapture(e.pointerId)
  }
  function placeItemBar() {
    if (chosen) {
      const n = chosen.items.size + chosen.frames.size
      const its = [...chosen.items].map((id) => board.items.find((i) => i.id === id)).filter((i) => i && i.kind !== 'guide')
      // Every selected object takes the colour clicked; the swatches are those of the kind most of them are.
      const paletteOf = (k) => (k === 'note' ? NOTE_COLORS : k === 'section' ? SECTION_COLORS : SHAPE_COLORS)
      const colors = its.length ? paletteOf(its.filter((i) => i.kind === 'note').length * 2 > its.length ? 'note' : its.every((i) => i.kind === 'section') ? 'section' : 'shape') : []
      const same = its.length && its.every((i) => (i.color || paletteOf(i.kind)[0]) === (its[0].color || paletteOf(its[0].kind)[0])) ? its[0].color || paletteOf(its[0].kind)[0] : null
      const grouped = its.length > 1 && its.every((i) => i.group && i.group === its[0].group)
      const anyGroup = its.some((i) => i.group)
      itemBar.replaceChildren(...[
        h('span', { class: 'count-note' }, grouped ? `Group of ${its.length}` : `${n} selected`),
        ...colors.map((c) => h('button', { type: 'button', class: `swatch${same === c ? ' on' : ''}`, style: `background:${c}`, title: COLOR_NAMES[c] ?? c, 'aria-label': COLOR_NAMES[c] ?? c, 'aria-pressed': String(same === c), onclick: () => colorChosen(c) })),
        colors.length ? h('span', { class: 'sep' }) : null,
        selectedUnits().length > 1 ? h('button', { type: 'button', class: 'tool', title: 'Align and space evenly', 'aria-haspopup': 'menu', onclick: (e) => alignMenu(e.currentTarget) }, 'Align', h('span', { class: 'caret' }, '▾')) : null,
        its.length > 1 && !grouped ? h('button', { type: 'button', class: 'tool', title: 'Group them: they move, colour and delete as one (Ctrl+G)', onclick: () => groupChosen(true) }, 'Group') : null,
        anyGroup ? h('button', { type: 'button', class: 'tool', title: 'Ungroup (Ctrl+Shift+G)', onclick: () => groupChosen(false) }, 'Ungroup') : null,
        api ? h('button', { type: 'button', class: 'tool', title: 'Ask the agent about what is in the box', onclick: () => openAsk() }, '✦ Ask agent') : null,
        chosen.items.size ? h('button', { type: 'button', class: 'tool', title: 'Delete (Delete)', onclick: () => removeChosen() }, 'Delete') : null,
        ...(owner() ? [
          [...chosen.items, ...chosen.frames].some((k) => !isLocked(k)) ? h('button', { type: 'button', class: 'tool', title: 'Lock everything selected', onclick: () => setLock([...chosen.items, ...chosen.frames], true) }, icon('lock'), 'Lock') : null,
          [...chosen.items, ...chosen.frames].some(isLocked) ? h('button', { type: 'button', class: 'tool', title: 'Unlock everything selected', onclick: () => setLock([...chosen.items, ...chosen.frames].filter(isLocked), false) }, icon('unlock'), 'Unlock') : null,
        ] : []),
      ].filter(Boolean))
      const top = toScreen(chosen.box.x, chosen.box.y)
      itemBar.style.left = `${Math.max(8, Math.min(innerWidth - 300, top.x))}px`
      itemBar.style.top = `${Math.max(56, top.y - 46)}px`
      itemBar.classList.add('open')
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
    const colors = it.kind === 'note' ? NOTE_COLORS : it.kind === 'section' ? SECTION_COLORS : it.kind === 'guide' ? [] : SHAPE_COLORS
    itemBar.replaceChildren(...[
      ...colors.map((c) => h('button', { type: 'button', class: `swatch${(it.color || colors[0]) === c ? ' on' : ''}`, style: `background:${c}`, title: COLOR_NAMES[c] ?? c, 'aria-label': COLOR_NAMES[c] ?? c, 'aria-pressed': String((it.color || colors[0]) === c), onclick: () => updateItem(it.id, { color: c }) })),
      ...(it.kind === 'guide'
        ? [
            h('label', {}, 'Cols', h('input', { type: 'number', min: 1, max: 24, value: it.cols ?? 12, onchange: (e) => updateItem(it.id, { cols: Number(e.target.value) || 12 }) })),
            h('label', {}, 'Gutter', h('input', { type: 'number', min: 0, max: 200, value: it.gutter ?? 24, onchange: (e) => updateItem(it.id, { gutter: Number(e.target.value) || 0 }) })),
            h('label', {}, 'Margin', h('input', { type: 'number', min: 0, max: 600, value: it.margin ?? 80, onchange: (e) => updateItem(it.id, { margin: Number(e.target.value) || 0 }) })),
          ]
        : []),
      h('span', { class: 'sep' }),
      h('button', { type: 'button', class: 'tool', title: 'Delete (Delete)', onclick: () => removeItem(it.id) }, 'Delete'),
      owner() ? h('button', { type: 'button', class: 'tool', title: 'Lock it: nobody moves, changes or deletes it, and visitors put nothing over it', onclick: () => setLock([it.id], true) }, icon('unlock'), 'Lock') : null,
    ].filter(Boolean))
    }
    const f = it.kind === 'guide' ? findFrame(it.frame) : null
    const top = toScreen(f ? f.x : it.x, f ? f.y : it.y)
    itemBar.style.left = `${Math.max(8, Math.min(innerWidth - 300, top.x))}px`
    itemBar.style.top = `${Math.max(56, top.y - 46)}px`
    itemBar.classList.add('open')
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
  // ── snapping: what is dragged lines up with what it passes, and the line it lines up on is drawn ──
  const SNAP_PX = 6
  let snapEls = []
  const clearSnap = () => {
    for (const el of snapEls) el.remove()
    snapEls = []
  }
  /** For a drag of these objects and frames: a function from the drag's offset to the offset caught on the nearest edge or centre. */
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
    return (dx, dy) => {
      const b = { x: start.x + dx, y: start.y + dy, w: start.w, h: start.h }
      const sx = nearest(marks(b, 'x', 'w'), xs)
      const sy = nearest(marks(b, 'y', 'h'), ys)
      if (sx) b.x += sx.d
      if (sy) b.y += sy.d
      clearSnap()
      if (sx) {
        const top = Math.min(b.y, sx.o.y) - 12 / view.z
        snapEls.push(h('div', { class: 'snap-line v', style: `left:${sx.at}px;top:${top}px;height:${Math.max(b.y + b.h, sx.o.y + sx.o.h) + 12 / view.z - top}px` }))
      }
      if (sy) {
        const left = Math.min(b.x, sy.o.x) - 12 / view.z
        snapEls.push(h('div', { class: 'snap-line h', style: `top:${sy.at}px;left:${left}px;width:${Math.max(b.x + b.w, sy.o.x + sy.o.w) + 12 / view.z - left}px` }))
      }
      world.append(...snapEls)
      return { dx: dx + (sx?.d ?? 0), dy: dy + (sy?.d ?? 0) }
    }
  }
  function startItemDrag(e, id) {
    const it = board.items.find((i) => i.id === id)
    if (!it) return
    if (e.shiftKey) return toggleChosen(id)
    // A press on one object of a group takes the whole group.
    if (!chosen?.items.has(id) && withGroup(id).length > 1) chooseItems(withGroup(id))
    const group = chosen?.items.has(id) ? chosen : null
    if (!group) pickItem(id)
    if (it.kind === 'guide') return
    if (!group && isLocked(id)) return
    // Near the bottom-right corner it resizes; anywhere else it moves.
    const p = toWorld(e.clientX, e.clientY)
    const resize = !group && ['note', 'rect', 'ellipse', 'section'].includes(it.kind) && p.x > it.x + it.w - 24 / view.z && p.y > it.y + it.h - 24 / view.z
    const w0 = it.w
    const h0 = it.h
    // What moves with it: everything a drag box took in, or everything inside a section.
    const along = group ? { items: [...group.items], frames: [...group.frames] } : it.kind === 'section' && !resize ? inside(it) : { items: [id], frames: [] }
    if (!along.items.includes(id)) along.items.push(id)
    // A line moved by hand lets go of what it held, and stays where it was drawn.
    const moving = along.items.map((x) => board.items.find((i) => i.id === x)).filter((i) => i && i.kind !== 'guide' && !isLocked(i.id))
    for (const m of moving) {
      if (m.id !== id || (!m.from && !m.to)) continue
      Object.assign(m, geometryOf(m), { from: '', to: '' })
    }
    const starts = new Map(moving.map((m) => [m.id, { x: m.x, y: m.y }]))
    const frameList = along.frames.map((k) => allFrames.get(k)).filter((f) => f && !isLocked(f.key))
    const frameStarts = new Map(frameList.map((f) => [f.key, { x: f.x, y: f.y }]))
    const boxStart = group ? { ...group.box } : null
    const snap = resize ? null : snapper(moving.map((m) => m.id), frameList.map((f) => f.key))
    drag = {
      kind: 'item', id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false,
      move: (ev, dx, dy) => {
        if (resize) Object.assign(it, { w: Math.max(40, Math.round(w0 + dx)), h: Math.max(30, Math.round(h0 + dy)) })
        else {
          // Edges and centres catch on other objects' and frames' edges and centres; Ctrl or ⌘ held lets go.
          ;({ dx, dy } = snap && !(ev.ctrlKey || ev.metaKey) ? snap(dx, dy) : (clearSnap(), { dx, dy }))
          for (const m of moving) Object.assign(m, { x: Math.round(starts.get(m.id).x + dx), y: Math.round(starts.get(m.id).y + dy) })
          for (const f of frameList) {
            Object.assign(f, { x: Math.round(frameStarts.get(f.key).x + dx), y: Math.round(frameStarts.get(f.key).y + dy) })
            positionFrame(f)
          }
          if (group) Object.assign(group.box, { x: Math.round(boxStart.x + dx), y: Math.round(boxStart.y + dy) })
        }
        // The bar would sit over what is being moved; it comes back where the drag ends.
        itemBar.classList.add('dragging')
        renderItems()
        if (snapEls.length) world.append(...snapEls)
        if (frameList.length) {
          renderPins()
          call('onView')
        }
      },
      end: async (_, moved) => {
        clearSnap()
        itemBar.classList.remove('dragging')
        if (!moved) return
        if (resize) return updateItem(id, { w: it.w, h: it.h })
        try {
          for (const m of moving) {
            const change = { x: m.x, y: m.y }
            if (m.from === '' || m.to === '') Object.assign(change, { w: m.w, h: m.h, points: m.points, from: '', to: '' })
            await sendBoard({ op: 'item', id: m.id, ...change })
          }
          for (const f of frameList) await sendBoard({ op: 'move', key: f.key, x: f.x, y: f.y, page: pageId })
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
    if (!it || !['note', 'title', 'rect', 'ellipse', 'section'].includes(it.kind)) return
    if (!serve) return
    if (isLocked(id)) return hint(LOCKED, 2000)
    const box = (it.kind === 'section' ? sectionLayer : itemLayer).querySelector(`[data-id="${id}"]`)
    const el = box?.querySelector('.txt') ?? box
    if (!el) return
    box.querySelector('.grip')?.remove()
    box.classList.add('editing')
    el.contentEditable = 'plaintext-only'
    el.focus()
    document.getSelection().selectAllChildren(el)
    const done = () => {
      el.removeEventListener('blur', done)
      el.contentEditable = 'false'
      const text = el.innerText.replace(/\n$/, '')
      if (text !== (it.text ?? '')) updateItem(id, { text })
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
  function startDraw(e, p, f) {
    if (!serve) return
    const kind = tool
    if (kind === 'guide') {
      if (!f) return hint('Click a frame to lay a 12-column guide over it.')
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
    drag = {
      kind: 'draw', id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false,
      move: (ev) => {
        last = toWorld(ev.clientX, ev.clientY)
        if (kind === 'pencil') pts.push(Math.round(last.x), Math.round(last.y))
        if (kind === 'pencil' || kind === 'line' || kind === 'arrow') {
          const all = kind === 'pencil' ? pts : [p.x, p.y, last.x, last.y]
          const d = all.reduce((s, v, i) => s + (i % 2 ? `,${v}` : `${i ? ' L' : 'M'}${v}`), '')
          svgGhost.innerHTML = `<svg style="overflow:visible;position:absolute;left:0;top:0" width="1" height="1"><path d="${d}" fill="none" stroke="#3b82f6" stroke-width="${4 / Math.max(view.z, 0.2)}" stroke-linecap="round"/></svg>`
        } else {
          Object.assign(ghost.style, { left: `${Math.min(p.x, last.x)}px`, top: `${Math.min(p.y, last.y)}px`, width: `${Math.abs(last.x - p.x)}px`, height: `${Math.abs(last.y - p.y)}px` })
        }
      },
      end: async (_, moved) => {
        ghost.remove()
        svgGhost.remove()
        let x = Math.min(p.x, last.x)
        let y = Math.min(p.y, last.y)
        let w = Math.abs(last.x - p.x)
        let hgt = Math.abs(last.y - p.y)
        if (kind === 'artboard') {
          if (!moved || w < 40) {
            w = 1440
            hgt = 900
          }
          setTool('select')
          return newArtboard(x, y, w, hgt)
        }
        let item
        if (kind === 'pencil' || kind === 'line' || kind === 'arrow') {
          const all = kind === 'pencil' ? pts : [p.x, p.y, last.x, last.y]
          if (!moved || all.length < 4) return
          const xs = all.filter((_, i) => i % 2 === 0)
          const ys = all.filter((_, i) => i % 2 === 1)
          x = Math.min(...xs)
          y = Math.min(...ys)
          w = Math.max(...xs) - x
          hgt = Math.max(...ys) - y
          item = { kind, x, y, w, h: hgt, points: all.map((v, i) => Math.round(v - (i % 2 ? y : x))) }
          // A line or arrow begun or ended on an object or a frame holds on to it.
          if (kind !== 'pencil') {
            const from = bindAt(p)
            const to = bindAt(last)
            if (from) item.from = from
            if (to && to !== from) item.to = to
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
        if (id) {
          renderItems()
          if (kind !== 'pencil') pickItem(id)
          if (kind === 'note' || kind === 'section') editItemText(id)
        }
      },
    }
    viewport.setPointerCapture(e.pointerId)
  }
  async function newArtboard(x, y, w, hgt) {
    const name = await question('Name the new prototype file. It is made in the canvas folder.', 'untitled')
    if (!name) return
    try {
      const res = await fetch('/api/artboard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, x, y, w, h: hgt, page: pageId, by: me || 'someone' }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Making it failed (${res.status})`)
      // Served by node, the server rebuilds and every page reloads; from disk, the frame is added here.
      if (body.event) {
        boardEvents.push(body.event)
        board = foldBoard(boardEvents)
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
    if (input.op === 'lock') return owner() ? null : 'Only the owner locks and unlocks'
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
    board = foldBoard(boardEvents)
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
      board = foldBoard(boardEvents)
      if (was) remember(was, stateOf(board, body.event))
      return body.event
    } finally {
      pending--
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
    try {
      for (const file of files) {
        const res = await fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file, edit: { op: 'replaceText', find, with: put }, name: me || 'someone' }) })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || `Replacing failed (${res.status})`)
        if (body.same) continue
        n += body.count ?? 0
        noteFileEdit()
        reloadFile(file, body.html)
      }
      const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      for (const id of [...new Set(found.filter((m) => m.item).map((m) => m.item))]) {
        const it = board.items.find((i) => i.id === id)
        if (!it || isLocked(id)) continue
        const text = String(it.text ?? '').replace(re, () => (n++, put))
        it.text = text
        await sendBoard({ op: 'item', id, text })
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
  const ITEM_KEYS = ['kind', 'page', 'x', 'y', 'w', 'h', 'z', 'text', 'color', 'frame', 'from', 'to', 'group', 'cols', 'gutter', 'margin', 'points']
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
      return { key: ev.key, state: m ? { x: m.x, y: m.y, page: m.page ?? f?.page ?? null } : null }
    }
    return null
  }
  function remember(before, after) {
    // A new object's id is only known from its line.
    if (before.id === null) before.id = after.id
    if (!openStep) {
      openStep = { kind: 'board', changes: new Map() }
      history.push(openStep)
      future.length = 0
      if (history.length > 200) history.shift()
      const step = openStep
      // The step closes once its action has sent everything: each send starts as the last one ends, before any timer.
      const close = () => (pending ? setTimeout(close, 0) : openStep === step && (openStep = null))
      setTimeout(close, 0)
    }
    const k = before.id ?? `frame:${before.key}`
    const c = openStep.changes.get(k)
    if (c) c.after = after.state
    else openStep.changes.set(k, { id: before.id, key: before.key, before: before.state, after: after.state })
  }
  let pending = 0
  /** Put every object and frame of a step back as it was (or forward as it became). */
  async function replay(step, back) {
    replaying = true
    try {
      for (const c of [...step.changes.values()].reverse()) {
        const want = back ? c.before : c.after
        const other = back ? c.after : c.before
        if (c.key) {
          if (want) await sendBoard({ op: 'move', key: c.key, x: want.x, y: want.y, ...(want.page ? { page: want.page } : {}) })
          continue
        }
        if (!want) {
          if (board.items.some((i) => i.id === c.id)) await sendBoard({ op: 'remove', id: c.id })
          continue
        }
        // A field the other side had and this one lacks is cleared.
        const clear = Object.fromEntries(Object.keys(other ?? {}).filter((k) => want[k] == null).map((k) => [k, ['x', 'y', 'w', 'h', 'z', 'cols', 'gutter', 'margin'].includes(k) ? 0 : k === 'points' ? [] : '']))
        await sendBoard({ op: 'item', id: c.id, ...clear, ...want })
      }
    } finally {
      replaying = false
      relayout()
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
    if (top.kind === 'file') return false
    try {
      await replay(top, !redo)
      hint(redo ? 'Redone' : 'Undone', 900)
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
  const readOnly = 'Opened from disk, so it only shows until editing is on. Click Edit here (Chrome or Edge) and allow the folder it is in.'
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
      if (at) return { x: at.x, y: at.y, frame: f, page: f.page }
      return { x: f.x + t.x * (f.s ?? 1), y: f.y + t.y * (f.s ?? 1), frame: f, page: f.page, detached: !!f.doc }
    }
    return f ? { x: f.x + t.x * (f.s ?? 1), y: f.y + t.y * (f.s ?? 1), frame: f, page: f.page } : { x: t.x, y: t.y, frame: null, page: t.page ?? firstPage() }
  }
  const number = (t) => threads.indexOf(t) + 1 || '…'
  const when = (iso) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  function renderPins() {
    pinLayer.replaceChildren()
    for (const t of threads) {
      const p = anchorOf(t)
      if (p.page !== pageId) continue
      pinLayer.append(h('button', {
        type: 'button',
        class: `pin${t.resolved ? ' resolved' : ''}${t.agent ? ' agent' : ''}${t.id === activeId ? ' active' : ''}${p.detached ? ' detached' : ''}`,
        style: `left:${p.x}px;top:${p.y}px`,
        title: `${t.name}: ${t.text}${p.detached ? ' (its element is gone; pinned where it was left)' : ''}`,
        onclick: (e) => { e.stopPropagation(); openThread(t.id) },
      }, String(number(t))))
    }
    if (draft) pinLayer.append(h('div', { class: 'pin active', style: `left:${draft.wx}px;top:${draft.wy}px` }, '+'))
    const open = threads.filter((t) => !t.resolved).length
    $('#comment-count').textContent = String(open)
    $('#comment-count').hidden = !open
    renderList()
  }
  function renderList() {
    const list = $('#comment-list')
    document.body.classList.toggle('hide-resolved', !showResolved())
    const shown = threads.filter((t) => showResolved() || !t.resolved)
    list.replaceChildren(...(shown.length
      ? shown.map((t) => {
          const f = t.frame ? findFrame(t.frame) : null
          return h('button', { type: 'button', class: `citem${t.resolved ? ' resolved' : ''}${t.agent ? ' agent' : ''}${t.id === activeId ? ' active' : ''}`, onclick: () => openThread(t.id, true) },
            h('div', { class: 'meta' }, h('span', { class: 'num' }, String(number(t))), h('b', {}, t.name), h('span', {}, when(t.at)), t.agent ? h('span', {}, '· for the agent') : null, t.replies.length ? h('span', {}, `· ${t.replies.length} repl${t.replies.length === 1 ? 'y' : 'ies'}`) : null, t.resolved ? h('span', {}, '· resolved') : null),
            h('div', { class: 'body' }, t.text),
            h('div', { class: 'where' }, f ? `${pages().find((p) => p.id === f.page)?.title ?? ''} · ${f.label}` : 'On the board'))
        })
      : [h('div', { class: 'empty' }, api ? 'No comments yet. Press C, then click anywhere.' : 'No comments.')]))
  }

  function startComment(sx, sy, agent = false) {
    if (!api) return hint(readOnly, 3000)
    const p = toWorld(sx, sy)
    const f = frameAt(sx, sy)
    const pin = f ? call('commentAnchor', f, p) : null
    draft = { wx: p.x, wy: p.y, frame: f ? f.key : null, x: f ? Math.round((p.x - f.x) / f.s) : p.x, y: f ? Math.round((p.y - f.y) / f.s) : p.y, page: pageId, agent, ...(pin ?? {}) }
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
        if (activeId) {
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
  }

  // ── the thread popover ──
  const thread = $('#thread')
  let threadAt = null
  function openThread(id, fly = false) {
    draft = null
    activeId = id
    const t = threads.find((x) => x.id === id)
    if (!t) return
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
    const t = what.id ? threads.find((x) => x.id === what.id) : null
    const msgs = h('div', { class: 'msgs' })
    const error = h('div', { class: 'error' })
    const textarea = h('textarea', { placeholder: t ? 'Reply' : 'Leave a comment', maxlength: LIMITS.text, rows: '3' })
    if (typed) textarea.value = typed
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
          const ev = await send({ op: 'add', name, text, frame: d.frame, x: d.x, y: d.y, file: d.file, anchor: d.anchor, agent: forAgent.checked })
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
      for (const m of [{ ...t, root: true }, ...t.replies]) {
        msgs.append(h('div', { class: 'msg' },
          h('div', { class: 'who' }, h('b', {}, m.name), h('span', {}, when(m.at)),
            api ? h('button', { type: 'button', title: m.root ? 'Delete the whole thread' : 'Delete this reply', onclick: async () => {
              if (!(await sure(m.root ? 'Delete this thread and its replies for everyone?' : 'Delete this reply for everyone?', 'Delete', true))) return
              try {
                await send({ op: 'delete', to: m.id, name: me || 'someone' })
                if (m.root) closeThread()
                else { renderPins(); showThread({ id: t.id }) }
              } catch (err) { error.textContent = err.message }
            } }, 'Delete') : null),
          h('p', {}, m.text),
          m.root && t.file ? h('div', { class: 'on' }, `On ${t.file}${t.anchor ? ` · ${t.anchor.path}` : ''}`) : null))
      }
    }
    const head = h('div', { class: 'head' },
      h('b', {}, t ? `#${number(t)}${t.resolved ? ' · resolved' : ''}` : 'New comment'),
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
      h('button', { type: 'button', class: 'tool', title: 'Close', 'aria-label': 'Close', onclick: closeThread }, '✕'),
    )
    // Where comments cannot be saved, a thread is read and not answered: no composer at all.
    thread.replaceChildren(...[head, t ? msgs : null, api ? form : null].filter(Boolean))
    thread.classList.add('open')
    threadAt = t ? { thread: t } : { draft: what.draft }
    placeThread()
    if (!keepTyping) (me ? textarea : nameIn).focus({ preventScroll: true })
  }
  function placeThread() {
    if (!threadAt || !thread.classList.contains('open')) return
    const p = threadAt.thread ? anchorOf(threadAt.thread) : { x: threadAt.draft.wx, y: threadAt.draft.wy }
    const s = toScreen(p.x, p.y)
    const w = thread.offsetWidth || 300
    let left = s.x + 24
    if (left + w > innerWidth - 12) left = s.x - w - 12
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
    const top = Math.max(56, Math.min(Math.max(56, s.y - 30), floor - hgt))
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
    $('#ask-on').textContent = askRegion ? `On the ${n} thing${n === 1 ? '' : 's'} in the box` : askTarget ? `On ${askTarget.label}` : 'On the board, where the view is centred'
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
      const c = centre()
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
  function openPlay(f, width) {
    playing = f
    $('#play-title').textContent = `${pages().find((p) => p.id === f.page)?.title ?? ''} · ${f.label}`
    playFrame.srcdoc = docFor(f)
    play.classList.add('open')
    setPlayWidth(width ?? (f.meta.fluid ? 'fill' : store.get('playWidth') || 'fill'))
    closeMenu()
  }
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
  }
  for (const b of play.querySelectorAll('[data-width]')) b.addEventListener('click', () => setPlayWidth(b.dataset.width))
  $('#play-close').addEventListener('click', () => closePlay())
  $('#play-download').addEventListener('click', () => playing && downloadFile(playing.file))
  function closePlay() {
    play.classList.remove('open')
    playFrame.srcdoc = ''
    playing = null
  }
  // A link to another prototype, posted by the frame: move to that prototype.
  addEventListener('message', (e) => {
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
  /** Yes or no; `ok` names the yes button, `danger` colours it as a delete. */
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
  addEventListener('hashchange', () => {
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
    } else fitAll()
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
  /** Put a frame on another page, at the same spot. */
  async function moveFrameToPage(f, page) {
    await sendBoard({ op: 'move', key: f.key, x: f.x, y: f.y, page })
    layoutAll()
    renderPage()
  }

  // Zoom menu.
  zoomLabel.addEventListener('click', (e) => openMenu(e.currentTarget, [
    { label: 'Zoom in', key: '+', run: () => zoomAt(view.z * 1.25, centre().x, centre().y) },
    { label: 'Zoom out', key: '−', run: () => zoomAt(view.z / 1.25, centre().x, centre().y) },
    '-',
    { label: 'Zoom to fit', key: 'F', run: fitAll },
    { label: '50%', run: () => zoomAt(0.5, centre().x, centre().y) },
    { label: '100%', key: '0', run: () => zoomAt(1, centre().x, centre().y) },
    { label: '200%', run: () => zoomAt(2, centre().x, centre().y) },
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
  const TOOL_KEYS = { v: 'select', h: 'hand', t: 'text', a: 'artboard', n: 'note', p: 'pencil', c: 'comment' }
  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')) return
    if (play.classList.contains('open')) {
      if (e.key === 'Escape') closePlay()
      return
    }
    // An open menu takes Escape first, opened by mouse or keyboard: it closes, and nothing under it moves.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      return openFind()
    }
    if (e.key === 'Escape' && menu.classList.contains('open')) {
      e.preventDefault()
      return closeMenu(true)
    }
    if (call('onKey', e)) return
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
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g' && chosen?.items.size && serve) {
      e.preventDefault()
      return groupChosen(!e.shiftKey)
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && serve) {
      const k = e.key.toLowerCase()
      if ((k === ']' || k === '[') && selectedItems().length) {
        e.preventDefault()
        return restack(k === ']')
      }
      const done = k === 'd' ? (selectedItems().length ? (duplicateItems(), true) : false) : k === 'c' ? copyItems() : k === 'v' ? pasteItems() : false
      if (done) return e.preventDefault()
    }
    // Figma's align keys, by the key's place so a Mac's Option characters do not matter.
    if (e.altKey && !e.ctrlKey && !e.metaKey && serve && chosen?.items.size > 1) {
      const how = e.shiftKey ? { KeyH: 'x', KeyV: 'y' }[e.code] : { KeyA: 'left', KeyH: 'centre', KeyD: 'right', KeyW: 'top', KeyV: 'middle', KeyS: 'bottom' }[e.code]
      if (how) {
        e.preventDefault()
        return e.shiftKey ? distributeChosen(how) : alignChosen(how)
      }
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (e.key === 'Escape') {
      if (menu.classList.contains('open')) closeMenu(true)
      else if (ask.classList.contains('open')) closeAsk()
      else if (thread.classList.contains('open')) closeThread()
      else if (picked || chosen) pickItem(null)
      else setTool('select')
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && chosen?.items.size) {
      removeChosen()
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && picked) {
      removeItem(picked)
    } else if (TOOL_KEYS[k]) {
      if (usable(TOOL_KEYS[k])) setTool(TOOL_KEYS[k])
    } else if (k === 'r' && serve) setShape(SHAPES.includes(tool) && tool !== 'section' ? tool : shapeKind === 'section' ? 'rect' : shapeKind)
    else if (k === 's' && serve) setShape('section')
    else if (k === 'f' || (e.key === '!' && e.shiftKey)) fitAll()
    else if (e.shiftKey && e.code === 'Digit2') zoomToSelection()
    else if (e.key === '=' || e.key === '+') zoomAt(view.z * 1.25, centre().x, centre().y)
    else if (e.key === '-') zoomAt(view.z / 1.25, centre().x, centre().y)
    else if (e.key === '0') zoomAt(1, centre().x, centre().y)
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
  async function fileChanged(file) {
    try {
      const res = await fetch(`/api/file?f=${encodeURIComponent(file)}`, { cache: 'no-store' })
      const body = await res.json()
      if (res.ok) {
        reloadFile(file, body.html)
        call('onOutsideChange', file)
        hint(`${file} changed outside the canvas; redrawn`, 2000)
      }
    } catch {}
  }
  /** Someone else changed the board: take its lines again. Not mid-drag or mid-typing; the next change brings it. */
  async function refreshBoard() {
    if (drag || document.querySelector('.items .editing')) return
    try {
      const res = await fetch('/api/board', { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok || !Array.isArray(body.events) || body.events.length === boardEvents.length) return
      boardEvents = body.events
      board = foldBoard(boardEvents)
      // The canvas's name is a board line too: a rename made elsewhere, or kept by a visitor's browser, shows.
      setTitle()
      relayout()
    } catch {}
  }
  // ── the server's news ──
  if (serve) {
    try {
      const stream = new EventSource('/api/stream')
      stream.addEventListener('file', (e) => fileChanged(JSON.parse(e.data).file))
      stream.addEventListener('lines', refresh)
      stream.addEventListener('board', refreshBoard)
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
    choose, geometryOf,
    get pages() { return pages() },
    get threads() { return threads },
    overlay, viewport, world,
    toWorld, toScreen, frameAt, findFrame, showFrame, docFor, plainFile, reloadFile, relayout, downloadFile,
    setTool, openPanel, setPanel, currentTab, openMenu, closeMenu, question, sure, openPlay, goPage, moveFrameToPage,
    startComment, commentOn, openAsk, renderPins, pickItem, apply, sendBoard, showEmpty,
    setName: (n) => setName(n),
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
    board = foldBoard(boardEvents)
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
    } else fitAll()
    const tab = store.get('tab')
    if (store.get('panel')) openPanel(tab || 'properties')
    refresh()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else queueMicrotask(start)
  setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 20000)
  addEventListener('focus', refresh)
})()
