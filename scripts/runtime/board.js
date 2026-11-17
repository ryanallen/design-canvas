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
    updateSub()
    call('onPage', pageId)
  }
  function drawGroups() {
    for (const el of sectionEls) el.remove()
    sectionEls = []
    const page = data.pages.find((p) => p.id === pageId)
    for (const section of page?.sections ?? []) {
      if (!section.groups.some((g) => g.frames.some((f) => allFrames.get(f._key ?? frameKey(f))?.page === pageId))) continue
      sectionEls.push(h('div', { class: 'label section-label', style: `left:${section.bounds.x}px;top:${section.bounds.y}px` }, section.title, section.sub ? h('small', {}, section.sub) : null))
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
  function apply() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`
    world.style.setProperty('--z', view.z)
    world.style.setProperty('--iz', 1 / view.z)
    zoomLabel.textContent = `${Math.round(view.z * 100)}%`
    document.body.classList.toggle('tiny', 1440 * view.z < 150)
    placeThread()
    placeItemBar()
    call('onView')
    clearTimeout(loadTimer)
    loadTimer = setTimeout(loadVisible, 120)
    store.set(`view:${pageId}`, view)
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
  function fitTo(box, pad = 60) {
    const vw = viewport.clientWidth - panelWidth()
    const top = 48
    const vh = viewport.clientHeight - top - 64
    const z = Math.min(1, MAX_Z, Math.max(MIN_Z, Math.min((vw - pad * 2) / box.w, (vh - pad * 2) / box.h)))
    view.z = z
    view.x = (vw - box.w * z) / 2 - box.x * z
    view.y = top + (vh - box.h * z) / 2 - box.y * z
    apply()
  }
  const fitAll = () => fitTo(extent())
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

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault()
    // A mouse wheel's notch (lines, or a delta of 50 and up) moves the zoom shown by 2 points below
    // 100%, and by 2% of itself above; a trackpad pinch's small deltas zoom with the fingers.
    if (e.ctrlKey || e.metaKey) {
      const notch = e.deltaMode === 1 || Math.abs(e.deltaY) >= 50
      zoomAt(notch ? view.z - Math.sign(e.deltaY) * 0.02 * Math.max(1, view.z) : view.z * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY)
    }
    else {
      view.x -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX
      view.y -= e.shiftKey && !e.deltaX ? 0 : e.deltaY
      apply()
    }
  }, { passive: false })

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
  viewport.addEventListener('pointerdown', (e) => {
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
    viewport.setPointerCapture(e.pointerId)
  })
  viewport.addEventListener('pointermove', (e) => {
    if (!drag) {
      if (!spaceHeld && tool !== 'hand') call('onHover', e, { frame: frameAt(e.clientX, e.clientY), point: toWorld(e.clientX, e.clientY), tool })
      return
    }
    if (drag.id !== e.pointerId) return
    const dx = e.clientX - drag.sx
    const dy = e.clientY - drag.sy
    if (!drag.moved && Math.hypot(dx, dy) < 4) return
    drag.moved = true
    if (drag.kind === 'pan') {
      viewport.classList.add('panning')
      view.x = drag.vx + dx
      view.y = drag.vy + dy
      apply()
    } else drag.move?.(e, dx / view.z, dy / view.z)
  })
  const endDrag = (e) => {
    if (!drag || drag.id !== e.pointerId) return
    const d = drag
    drag = null
    viewport.classList.remove('panning')
    if (d.kind !== 'pan') return d.end?.(e, d.moved)
    if (d.moved || d.forced) return
    emptyClick(e)
  }
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
        f.x = Math.round(x0 + dx)
        f.y = Math.round(y0 + dy)
        positionFrame(f)
        renderItems()
        renderPins()
        call('onView')
      },
      end: (_, moved) => {
        if (!moved) return call('onFramePick', f)
        sendBoard({ op: 'move', key: f.key, x: f.x, y: f.y, page: pageId }).catch((err) => hint(err.message, 3000))
      },
    }
    viewport.setPointerCapture(e.pointerId)
  }

  // ── board objects ──
  const NOTE_COLORS = ['#fde68a', '#bfdbfe', '#ddd6fe', '#fbcfe8', '#bbf7d0', '#fed7aa']
  const SHAPE_COLORS = ['#8a8a96', '#3b82f6', '#a855f7', '#ec4899', '#22c55e', '#f59e0b', '#ef4444', '#ffffff']
  const SECTION_COLORS = ['#8a8a96', '#3b82f6', '#a855f7', '#ec4899', '#22c55e', '#f59e0b']
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
      const all = items()
      sectionLayer.replaceChildren(...all.filter((i) => i.kind === 'section').map(itemEl).filter(Boolean))
      itemLayer.replaceChildren(...all.filter((i) => i.kind !== 'section').map(itemEl).filter(Boolean))
      for (const f of frames()) f.el?.classList.toggle('chosen', !!chosen?.frames.has(f.key))
    } finally {
      drawingItems = false
    }
    if (itemsAgain) {
      itemsAgain = false
      renderItems()
    }
    placeItemBar()
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

  function itemEl(it) {
    it = geometryOf(it)
    const cls = `item ${it.kind}${picked === it.id || chosen?.items.has(it.id) ? ' on' : ''}`
    const box = `left:${it.x}px;top:${it.y}px;width:${it.w ?? 0}px;height:${it.h ?? 0}px`
    if (it.kind === 'note') return h('div', { class: cls, 'data-id': it.id, style: `${box};background:${it.color || NOTE_COLORS[0]}` }, it.text ?? '')
    if (it.kind === 'title') return h('div', { class: cls, 'data-id': it.id, style: `left:${it.x}px;top:${it.y}px;${it.color ? `color:${it.color}` : ''}` }, it.text || 'Title')
    if (it.kind === 'rect' || it.kind === 'ellipse') return h('div', { class: cls, 'data-id': it.id, style: `${box};--c:${it.color || SHAPE_COLORS[0]}` }, h('span', { class: 'txt' }, it.text ?? ''))
    if (it.kind === 'section') return h('div', { class: cls, 'data-id': it.id, style: `${box};--c:${it.color || SECTION_COLORS[0]}` }, h('span', { class: 'txt' }, it.text ?? ''))
    if (it.kind === 'guide') {
      const f = findFrame(it.frame)
      if (!f || f.page !== pageId) return null
      const cols = it.cols || 12
      const m = (it.margin ?? 80) * f.s
      const g = (it.gutter ?? 24) * f.s
      return h('div', { class: `item guide`, 'data-id': it.id, style: `left:${f.x + m}px;top:${f.y}px;width:${f.W - m * 2}px;height:${f.H}px;grid-template-columns:repeat(${cols},1fr);column-gap:${g}px` }, ...Array.from({ length: cols }, () => h('span'))
      )
    }
    if (['line', 'arrow', 'pencil'].includes(it.kind)) {
      const pts = it.points ?? []
      const d = pts.reduce((s, v, i) => s + (i % 2 ? `,${v}` : `${i ? ' L' : 'M'}${v}`), '')
      const color = it.color || SHAPE_COLORS[0]
      const marker = it.kind === 'arrow' ? `<defs><marker id="ah-${it.id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${color}"/></marker></defs>` : ''
      const svg = `<svg width="${Math.max(1, it.w)}" height="${Math.max(1, it.h)}" viewBox="0 0 ${Math.max(1, it.w)} ${Math.max(1, it.h)}">${marker}<path class="ink" d="${d}" fill="none" stroke="${color}" stroke-width="${it.kind === 'pencil' ? 5 : 4}" stroke-linecap="round" stroke-linejoin="round"${it.kind === 'arrow' ? ` marker-end="url(#ah-${it.id})"` : ''}/><path class="hit" d="${d}" fill="none" stroke="transparent" stroke-width="24"/></svg>`
      return h('div', { class: `${cls} svg`, 'data-id': it.id, style: box, html: svg })
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
  function choose(box) {
    const got = inside(box)
    picked = null
    chosen = got.items.length || got.frames.length ? { box, items: new Set(got.items), frames: new Set(got.frames) } : null
    call('onMarquee')
    renderItems()
    // The agent reads it at GET /api/selection.
    if (serve) fetch('/api/selection', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selection: chosen ? { board: { page: pageId, box, items: [...chosen.items], frames: [...chosen.frames] } } : null }) }).catch(() => {})
  }
  async function removeChosen() {
    const ids = [...(chosen?.items ?? [])]
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
      itemBar.replaceChildren(
        h('span', { class: 'count-note' }, `${n} selected`),
        api ? h('button', { type: 'button', class: 'tool', title: 'Ask the agent about what is in the box', onclick: () => openAsk() }, '✦ Ask agent') : null,
        chosen.items.size ? h('button', { type: 'button', class: 'tool', title: 'Delete (Delete)', onclick: () => removeChosen() }, 'Delete') : null,
      )
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
    const colors = it.kind === 'note' ? NOTE_COLORS : it.kind === 'section' ? SECTION_COLORS : it.kind === 'guide' ? [] : SHAPE_COLORS
    itemBar.replaceChildren(...[
      ...colors.map((c) => h('button', { type: 'button', class: `swatch${(it.color || colors[0]) === c ? ' on' : ''}`, style: `background:${c}`, title: c, onclick: () => updateItem(it.id, { color: c }) })),
      ...(it.kind === 'guide'
        ? [
            h('label', {}, 'Cols', h('input', { type: 'number', min: 1, max: 24, value: it.cols ?? 12, onchange: (e) => updateItem(it.id, { cols: Number(e.target.value) || 12 }) })),
            h('label', {}, 'Gutter', h('input', { type: 'number', min: 0, max: 200, value: it.gutter ?? 24, onchange: (e) => updateItem(it.id, { gutter: Number(e.target.value) || 0 }) })),
            h('label', {}, 'Margin', h('input', { type: 'number', min: 0, max: 600, value: it.margin ?? 80, onchange: (e) => updateItem(it.id, { margin: Number(e.target.value) || 0 }) })),
          ]
        : []),
      h('span', { class: 'sep' }),
      h('button', { type: 'button', class: 'tool', title: 'Delete (Delete)', onclick: () => removeItem(it.id) }, 'Delete'),
    ])
    const f = it.kind === 'guide' ? findFrame(it.frame) : null
    const top = toScreen(f ? f.x : it.x, f ? f.y : it.y)
    itemBar.style.left = `${Math.max(8, Math.min(innerWidth - 300, top.x))}px`
    itemBar.style.top = `${Math.max(56, top.y - 46)}px`
    itemBar.classList.add('open')
  }
  async function updateItem(id, change) {
    const it = board.items.find((i) => i.id === id)
    if (!it) return
    Object.assign(it, change)
    renderItems()
    try {
      await sendBoard({ op: 'item', id, ...change })
    } catch (err) {
      hint(err.message, 3000)
    }
  }
  async function removeItem(id) {
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
  function startItemDrag(e, id) {
    const it = board.items.find((i) => i.id === id)
    if (!it) return
    const group = chosen?.items.has(id) ? chosen : null
    if (!group) pickItem(id)
    if (it.kind === 'guide') return
    // Near the bottom-right corner it resizes; anywhere else it moves.
    const p = toWorld(e.clientX, e.clientY)
    const resize = !group && ['note', 'rect', 'ellipse', 'section'].includes(it.kind) && p.x > it.x + it.w - 24 / view.z && p.y > it.y + it.h - 24 / view.z
    const w0 = it.w
    const h0 = it.h
    // What moves with it: everything a drag box took in, or everything inside a section.
    const along = group ? { items: [...group.items], frames: [...group.frames] } : it.kind === 'section' && !resize ? inside(it) : { items: [id], frames: [] }
    if (!along.items.includes(id)) along.items.push(id)
    // A line moved by hand lets go of what it held, and stays where it was drawn.
    const moving = along.items.map((x) => board.items.find((i) => i.id === x)).filter((i) => i && i.kind !== 'guide')
    for (const m of moving) {
      if (m.id !== id || (!m.from && !m.to)) continue
      Object.assign(m, geometryOf(m), { from: '', to: '' })
    }
    const starts = new Map(moving.map((m) => [m.id, { x: m.x, y: m.y }]))
    const frameList = along.frames.map((k) => allFrames.get(k)).filter(Boolean)
    const frameStarts = new Map(frameList.map((f) => [f.key, { x: f.x, y: f.y }]))
    const boxStart = group ? { ...group.box } : null
    drag = {
      kind: 'item', id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false,
      move: (_, dx, dy) => {
        if (resize) Object.assign(it, { w: Math.max(40, Math.round(w0 + dx)), h: Math.max(30, Math.round(h0 + dy)) })
        else {
          for (const m of moving) Object.assign(m, { x: Math.round(starts.get(m.id).x + dx), y: Math.round(starts.get(m.id).y + dy) })
          for (const f of frameList) {
            Object.assign(f, { x: Math.round(frameStarts.get(f.key).x + dx), y: Math.round(frameStarts.get(f.key).y + dy) })
            positionFrame(f)
          }
          if (group) Object.assign(group.box, { x: Math.round(boxStart.x + dx), y: Math.round(boxStart.y + dy) })
        }
        renderItems()
        if (frameList.length) {
          renderPins()
          call('onView')
        }
      },
      end: async (_, moved) => {
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
    const box = (it.kind === 'section' ? sectionLayer : itemLayer).querySelector(`[data-id="${id}"]`)
    const el = box?.querySelector('.txt') ?? box
    if (!el) return
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
    const name = prompt('Name the new prototype file (it is made in the canvas folder):', 'untitled')
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

  async function sendBoard(input) {
    if (!serve) throw new Error(readOnly)
    const res = await fetch('/api/board', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: { name: me || 'someone', ...input } }) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `Saving failed (${res.status})`)
    boardEvents.push(body.event)
    board = foldBoard(boardEvents)
    return body.event
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
    $('#comment-count').textContent = String(threads.filter((t) => !t.resolved).length)
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
    if (t) {
      for (const m of [{ ...t, root: true }, ...t.replies]) {
        msgs.append(h('div', { class: 'msg' },
          h('div', { class: 'who' }, h('b', {}, m.name), h('span', {}, when(m.at)),
            api ? h('button', { type: 'button', title: m.root ? 'Delete the whole thread' : 'Delete this reply', onclick: async () => {
              if (!confirm(m.root ? 'Delete this thread and its replies for everyone?' : 'Delete this reply for everyone?')) return
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
    const hgt = thread.offsetHeight || 200
    let left = s.x + 24
    if (left + w > innerWidth - 12) left = s.x - w - 12
    const top = Math.min(Math.max(56, s.y - 30), innerHeight - hgt - 12)
    thread.style.left = `${Math.max(12, left)}px`
    thread.style.top = `${top}px`
  }

  // ── Ask agent ──
  const ask = $('#ask')
  let askTarget = null
  let askRegion = null
  function openAsk() {
    if (!api) return hint(readOnly, 3000)
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
    const name = me || prompt('Your name, to sign the request:') || ''
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
  function setPlayWidth(w) {
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
  }
  function closeMenu() {
    menu.classList.remove('open')
    menuFor = null
  }
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
      serve && !data.memory && !local ? { label: 'Refresh from the prototypes', run: rebuild } : null,
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
    const title = prompt('Rename the canvas:', data.title)
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
            const title = prompt('Rename the page:', p.title)
            if (!title?.trim()) return
            try { await sendBoard({ op: 'page', id: p.id, title: title.trim() }); renderPage() } catch (err) { hint(err.message, 3000) }
          } },
          { label: 'Delete', danger: true, disabled: pages().length < 2, run: async () => {
            if (!confirm(`Delete the page "${p.title}"? Its frames stay in their files; the page is hidden.`)) return
            try { await sendBoard({ op: 'page', id: p.id, removed: true }); if (p.id === pageId) goPage(firstPage()); else renderPage() } catch (err) { hint(err.message, 3000) }
          } },
        ]) : null,
      })),
      serve ? '-' : null,
      serve ? { label: 'New page', run: async () => {
        const title = prompt('Name the new page:', `Page ${pages().length + 1}`)
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
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (e.key === 'Escape') {
      if (menu.classList.contains('open')) closeMenu()
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
  function enableLocal(folderName, title = 'Edits and comments are written into this folder by the page itself') {
    serve = true
    api = '/api/canvas-comments'
    local = true
    document.body.classList.add('serving', 'commenting')
    $('#canvas-mode').textContent = `Editing ${folderName}`
    $('#canvas-mode').title = title
    for (const file of Object.keys(data.files)) {
      delete fileHtml[file]
      for (const f of allFrames.values()) if (f.file === file && f.loaded && f.el) loadFrame(f)
    }
    refresh()
    renderPins()
  }

  // ── what the editor works through ──
  window.designCanvas = {
    get serve() { return serve },
    get local() { return local },
    get commenting() { return !!api },
    data, web, hooks, h, icon, store, hint, readOnly, fileChanged, enableLocal, refreshBoard, relayoutAll: () => { layoutAll(); renderPage() },
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
    toWorld, toScreen, frameAt, findFrame, docFor, plainFile, reloadFile, relayout, downloadFile,
    setTool, openPanel, setPanel, currentTab, openMenu, closeMenu, openPlay, goPage, moveFrameToPage,
    startComment, commentOn, openAsk, renderPins, pickItem, apply, sendBoard,
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
