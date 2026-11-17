// The editor: selection inside frames, the selection box and its handles, the floating toolbar,
// text edited in place, structure (drag, resize, duplicate, delete, group, wrap, copy, paste,
// nudge), undo and redo, and the anchors that pin a comment to an element. The right panel
// (layers, Properties, Code, Tweaks) is panel.js, which works through `designCanvas.editor`.
//
// Every element of a served prototype carries `data-cv`, the offset of its `<` in the file. An
// edit names elements by it and goes to the server, which writes the file and answers with the
// new HTML; the frames redraw and the selection comes back by the offset the server gives.
;(() => {
  const dc = window.designCanvas
  const { h, hooks, hint } = dc
  const overlay = dc.overlay
  const floatBar = document.getElementById('float')

  // ── what an element is ──
  const INLINE = new Set(['span', 'b', 'strong', 'i', 'em', 'u', 's', 'small', 'mark', 'code', 'sub', 'sup', 'abbr', 'cite', 'q', 'kbd', 'time', 'br', 'wbr', 'label'])
  const SKIP = new Set(['script', 'style', 'template', 'noscript', 'head', 'meta', 'link', 'title', 'base'])
  const SINGLE_LINE = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'button', 'label', 'li', 'td', 'th', 'span', 'dt', 'summary', 'option', 'figcaption', 'legend'])
  const cvOf = (el) => (el?.dataset?.cv != null ? Number(el.dataset.cv) : null)
  // Locked: an element carrying data-locked, with everything in it, or a prototype locked on the board.
  const fileOf = (el) => dc.allFrames.find((f) => f.doc && f.doc === el?.ownerDocument)?.file
  const fileLocked = (file) => !!file && dc.allFrames.some((f) => f.file === file && dc.isLocked(f.key))
  const lockedEl = (el) => !!el?.closest?.('[data-locked]') || fileLocked(fileOf(el))
  const editable = (el) => dc.serve && cvOf(el) != null && !lockedEl(el)
  const win = (el) => el.ownerDocument.defaultView
  const cs = (el) => win(el).getComputedStyle(el)
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim())
  /** An element that holds text: its own text, or only inline runs. */
  const isText = (el) => {
    if (!el || ['img', 'svg', 'input', 'select', 'textarea', 'video', 'canvas', 'iframe', 'hr', 'body', 'html'].includes(el.localName)) return false
    if (ownText(el)) return true
    const kids = [...el.children]
    return kids.length > 0 && kids.every((k) => INLINE.has(k.localName) || (k.localName === 'a' && cs(k).display.startsWith('inline'))) && !!el.textContent.trim()
  }
  const inSvg = (el) => el.namespaceURI === 'http://www.w3.org/2000/svg'
  /** A click lands on the element that holds the text, not on a run inside it. */
  function climb(el) {
    if (!el) return null
    if (el.localName === 'html') el = el.ownerDocument.body
    while (inSvg(el) && el.localName !== 'svg') el = el.parentElement
    if (inSvg(el)) {
      while (el.parentElement && inSvg(el.parentElement)) el = el.parentElement
      return el
    }
    while (el.parentElement && el.parentElement.localName !== 'body' && (INLINE.has(el.localName) || (el.localName === 'a' && cs(el).display === 'inline')) && isText(el.parentElement)) el = el.parentElement
    return el
  }
  const sameKind = (a, b) => a.localName === b.localName && a.className === b.className && a.parentElement?.localName === b.parentElement?.localName && (a.parentElement?.className ?? '') === (b.parentElement?.className ?? '')
  const copiesOf = (el) => {
    if (['body', 'html'].includes(el.localName) || !el.className || typeof el.className !== 'string') return [el]
    return [...el.ownerDocument.querySelectorAll(el.localName)].filter((x) => sameKind(x, el))
  }
  const esc = (s) => String(s).replace(/[^\w-]/g, (c) => `\\${c}`)
  /** The selector a change to several copies is written to: their tag and classes, under their parent's class. */
  function copiesSelector(el) {
    const classes = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).map((c) => `.${esc(c)}`).join('')
    const pc = (el.parentElement?.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)[0]
    return `${pc ? `.${esc(pc)} > ` : ''}${el.localName}${classes}`
  }
  const excerpt = (el, n = 18) => {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
    return t.length > n ? `${t.slice(0, n)}…` : t
  }
  /** A layer's name: data-name, aria-label, then what it is and what it says. */
  function nameOf(el) {
    const own = el.getAttribute('data-name') || el.getAttribute('aria-label')
    if (own) return { kind: 'named', text: own }
    const t = el.localName
    const id = el.id ? ` #${el.id}` : ''
    const say = (k) => ({ kind: k, text: `${k}${id}${excerpt(el) ? ` "${excerpt(el)}"` : ''}` })
    if (/^h[1-6]$/.test(t)) return say('Heading')
    if (t === 'p') return say('Paragraph')
    if (t === 'a') return say('Link')
    if (t === 'button') return say('Button')
    if (t === 'img') return { kind: 'Image', text: `Image${el.alt ? ` "${el.alt}"` : ''}` }
    if (t === 'svg') return { kind: 'Vector', text: 'Vector' }
    if (['ul', 'ol'].includes(t)) return say('List')
    if (t === 'li') return say('Item')
    if (['input', 'select', 'textarea'].includes(t)) return { kind: 'Field', text: `Field${el.name ? ` ${el.name}` : ''}` }
    if (['header', 'footer', 'nav', 'main', 'section', 'article', 'aside', 'form', 'table'].includes(t)) return { kind: t, text: `${t[0].toUpperCase()}${t.slice(1)}${id}` }
    if (t === 'body') return { kind: 'body', text: 'Body' }
    const d = cs(el).display
    if (d.includes('flex')) return say(cs(el).flexDirection.startsWith('column') ? 'Column' : 'Row')
    if (d.includes('grid')) return say('Grid')
    if (isText(el)) return say('Text')
    return { kind: 'group', text: `${el.id ? `group #${el.id}` : el.classList[0] ? `group .${el.classList[0]}` : 'group'}` }
  }

  // ── selection ──
  let sel = null // { frame, els }
  let hover = null // { frame, el }
  let editing = null // { frame, el, before }
  let pendingSelect = null
  // An element of a frame that has since been redrawn belongs to a document with no window.
  const live = (el) => !!el && el.isConnected && !!el.ownerDocument.defaultView
  const primary = () => (live(sel?.els[0]) ? sel.els[0] : null)
  // `keep` leaves the server's selection alone, for a drag box that is about to set its own.
  function select(frame, els, { quiet = false, keep = false } = {}) {
    if (editing) stopEditing(true)
    els = (els || []).filter(live)
    sel = frame && els.length ? { frame, els } : null
    draw()
    renderFloat()
    if (!quiet) dc.pickItem(null)
    api.onChange()
    if (dc.serve && !keep) {
      const body = sel ? { file: sel.frame.file, frame: sel.frame.key, cvs: sel.els.map(cvOf).filter((x) => x != null), names: sel.els.map((e) => nameOf(e).text) } : null
      fetch('/api/selection', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selection: body }) }).catch(() => {})
    }
  }
  const pick = (frame, el, { add = false, alone = false } = {}) => {
    if (!el) return select(null, [])
    if (add && sel && sel.frame === frame) {
      const has = sel.els.includes(el)
      return select(frame, has ? sel.els.filter((x) => x !== el) : [...sel.els, el])
    }
    select(frame, alone ? [el] : copiesOf(el))
  }
  const local = (f, p) => ({ x: (p.x - f.x) / f.s, y: (p.y - f.y) / f.s })
  const elementAt = (f, p) => {
    if (!f?.doc) return null
    const l = local(f, p)
    return climb(f.doc.elementFromPoint(l.x, l.y))
  }

  // ── drawing the selection on the board ──
  const rectOn = (f, el) => {
    const r = el.getBoundingClientRect()
    const a = dc.toScreen(f.x + r.left * f.s, f.y + r.top * f.s)
    const k = f.s * dc.view.z
    return { x: a.x, y: a.y, w: r.width * k, h: r.height * k, r }
  }
  let dropLine = null
  function draw() {
    overlay.replaceChildren()
    if (hover && (!sel || !sel.els.includes(hover.el)) && live(hover.el)) {
      const b = rectOn(hover.frame, hover.el)
      overlay.append(h('div', { class: 'ov hover', style: box(b) }))
    }
    if (sel && sel.frame.doc) {
      sel.els = sel.els.filter(live)
      sel.els.forEach((el, i) => {
        const b = rectOn(sel.frame, el)
        const one = h('div', { class: `ov sel${i ? ' copy' : ''}`, style: box(b) })
        if (i === 0) {
          const n = nameOf(el)
          one.append(h('div', { class: 'ov-tag' }, `${n.text}${sel.els.length > 1 ? ` · ${sel.els.length} copies` : ''}`, h('span', {}, `${Math.round(b.r.width)} × ${Math.round(b.r.height)}`)))
          if (sel.els.length === 1 && editable(el) && !editing) {
            for (const hd of ['nw', 'ne', 'sw', 'se', 'e', 's']) one.append(h('div', { class: `handle ${hd}`, 'data-h': hd, onpointerdown: (e) => startResize(e, hd) }))
          }
        }
        overlay.append(one)
      })
    }
    if (dropLine) overlay.append(h('div', { class: 'ov drop', style: box(dropLine) }))
  }
  const box = (b) => `left:${b.x}px;top:${b.y}px;width:${Math.max(1, b.w)}px;height:${Math.max(1, b.h)}px`

  // ── the board's pointer, seen first here ──
  hooks.onPointerDown = (e, { frame, point, tool }) => {
    if (editing) {
      stopEditing(true)
      if (frame === editing?.frame) return true
    }
    if (!frame || !frame.doc) {
      if (tool === 'select' && frame) return true
      return false
    }
    if (tool === 'text') {
      if (!editable(frame.doc.body)) return true
      addText(frame, point)
      return true
    }
    if (tool !== 'select') return false
    const el = elementAt(frame, point)
    if (!el) return true
    const already = sel && sel.frame === frame && sel.els.includes(el)
    if (e.shiftKey) pick(frame, el, { add: true })
    else if (!already || e.altKey) pick(frame, el, { alone: e.altKey })
    // A press that moves drags the selection: a reorder in flow, or left and top when positioned.
    if (!e.shiftKey && sel && editable(primary()) && sel.els.length === 1 && primary().localName !== 'body') startMove(e, frame, point)
    return true
  }
  hooks.onHover = (e, info) => {
    if (!e || !info?.frame || dc.tool !== 'select' || editing) {
      if (hover) {
        hover = null
        draw()
      }
      return
    }
    const el = elementAt(info.frame, info.point)
    if (el !== hover?.el) {
      hover = el ? { frame: info.frame, el } : null
      draw()
      api.onHover(hover)
    }
  }
  hooks.onDblClick = (e, { frame, point }) => {
    if (!frame?.doc) return
    const el = elementAt(frame, point)
    if (!el) return
    if (isText(el)) startEditing(frame, el)
    else {
      // Double-click goes one level in, toward what was clicked.
      const deep = frame.doc.elementFromPoint(local(frame, point).x, local(frame, point).y)
      let k = deep
      while (k && k.parentElement !== el) k = k.parentElement
      if (k) pick(frame, k, { alone: true })
    }
  }
  hooks.onEmptyClick = () => select(null, [])
  hooks.onFramePick = (f) => {
    if (f.doc) pick(f, f.doc.body, { alone: true })
  }
  hooks.onItemPick = () => select(null, [], { quiet: true })
  hooks.onMarquee = () => select(null, [], { quiet: true, keep: true })
  hooks.onView = () => {
    draw()
    placeFloat()
  }
  hooks.onPage = () => {
    sel = null
    hover = null
    draw()
    renderFloat()
    api.onChange()
  }
  hooks.onTool = () => {
    hover = null
    draw()
  }
  hooks.onFrameLoad = (f) => {
    // The selection comes back by offset after the frame redraws.
    if (pendingSelect && pendingSelect.file === f.file && (pendingSelect.key ? pendingSelect.key === f.key : true)) {
      const el = pendingSelect.cv != null ? f.doc.querySelector(`[data-cv="${pendingSelect.cv}"]`) : null
      const keep = pendingSelect
      pendingSelect = null
      if (el) select(f, keep.copies ? copiesOf(el) : [el], { quiet: true })
      else select(null, [])
      if (keep.then) keep.then(f, el)
    } else if (sel && sel.frame === f) {
      select(null, [])
    }
    api.onFrameLoad(f)
    draw()
  }
  hooks.selectedFile = () => sel?.frame.file ?? null
  hooks.selectionTarget = () => {
    const el = primary()
    if (!el) return null
    const b = el.getBoundingClientRect()
    const a = anchorFor(sel.frame, el, 0, 0)
    return { frame: sel.frame, file: sel.frame.file, anchor: a, wx: sel.frame.x + b.left * sel.frame.s, wy: sel.frame.y + b.top * sel.frame.s, label: `${nameOf(el).text} in ${sel.frame.file}` }
  }
  hooks.onOutsideChange = () => {}

  // ── comment anchors: a path from the nearest element with an id or a data-name ──
  function anchorFor(f, el, dx, dy) {
    const steps = []
    let k = el
    while (k && k.localName !== 'body' && !k.id && !k.getAttribute('data-name')) {
      const parent = k.parentElement
      if (!parent) break
      steps.unshift([...parent.children].indexOf(k))
      k = parent
    }
    const root = !k || k.localName === 'body' ? 'body' : k.id ? `#${k.id}` : `[data-name="${k.getAttribute('data-name').replace(/"/g, '\\"')}"]`
    return { path: [root, ...steps].join(' > '), dx: Math.round(dx), dy: Math.round(dy) }
  }
  function resolveAnchor(doc, path) {
    const [root, ...steps] = path.split(' > ')
    let el
    try {
      el = root === 'body' ? doc.body : doc.querySelector(root)
    } catch {
      return null
    }
    for (const s of steps) {
      el = el?.children[Number(s)]
      if (!el) return null
    }
    return el
  }
  hooks.commentAnchor = (f, p) => {
    const el = elementAt(f, p)
    if (!el) return null
    const l = local(f, p)
    const r = el.getBoundingClientRect()
    return { file: f.file, anchor: anchorFor(f, el, l.x - r.left, l.y - r.top) }
  }
  hooks.anchorPoint = (t, f) => {
    if (!f.doc || !t.anchor || (t.file && t.file !== f.file)) return null
    const el = resolveAnchor(f.doc, t.anchor.path)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: f.x + (r.left + Math.min(t.anchor.dx, r.width)) * f.s, y: f.y + (r.top + Math.min(t.anchor.dy, r.height)) * f.s }
  }

  // ── writing ──
  let busy = false
  /** One edit to the selected frame's file. The answer redraws every frame of that file and the selection returns. */
  async function send(edit, { file = sel?.frame.file, key = sel?.frame.key, copies = false, then } = {}) {
    if (!dc.serve) return
    if (!file) return
    if (fileLocked(file)) return hint('This prototype is locked', 2000)
    if (busy) return hint('Still saving the last change', 1200)
    busy = true
    try {
      const res = await fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file, edit, name: dc.me || 'someone' }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Saving failed (${res.status})`)
      if (body.same) return
      pendingSelect = { file, key, cv: body.select, copies, then }
      dc.reloadFile(file, body.html)
    } catch (err) {
      hint(err.message, 4000)
      // A refused edit may already show in the frame: draw the file as it is.
      try {
        const res = await fetch(`/api/file?f=${encodeURIComponent(file)}`, { cache: 'no-store' })
        if (res.ok) dc.reloadFile(file, (await res.json()).html)
      } catch {}
    } finally {
      busy = false
    }
  }
  /** A style change to the selection: inline on one element, a rule for several copies. */
  function setStyle(props) {
    if (!sel) return
    const el = primary()
    if (!sel.els.every(editable)) return dc.serve && hint(notEditable(el), 3000)
    if (sel.els.length > 1 && sel.els.every((x) => sameKind(x, el))) {
      for (const x of sel.els) for (const [k, v] of Object.entries(props)) x.style.setProperty(k, v || '')
      return send({ op: 'rule', selector: copiesSelector(el), props, cv: cvOf(el) }, { copies: true })
    }
    if (sel.els.length > 1) return hint('Several different elements: select copies of one kind, or one element, to style', 3000)
    for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v || '')
    draw()
    return send({ op: 'style', cv: cvOf(el), props })
  }
  const notEditable = (el) => (!dc.serve ? dc.readOnly : el && fileLocked(fileOf(el)) ? 'This prototype is locked by its owner.' : el && lockedEl(el) ? 'This part is locked by its owner.' : el && cvOf(el) == null ? 'This element is made by the prototype\'s own script, so it can be inspected and not edited.' : 'Nothing editable is selected.')
  async function undo(redo = false) {
    if (!dc.serve) return
    const res = await fetch(redo ? '/api/redo' : '/api/undo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: dc.me || 'someone' }) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return hint(body.error || 'Nothing changed', 4000)
    if (body.none) return hint(redo ? 'Nothing to redo' : 'Nothing to undo', 1200)
    const keep = sel && sel.frame.file === body.file ? { file: body.file, key: sel.frame.key, cv: cvOf(primary()), copies: sel.els.length > 1 } : null
    pendingSelect = keep
    dc.reloadFile(body.file, body.html)
    hint(redo ? 'Redone' : 'Undone', 900)
  }

  // ── text in place ──
  function startEditing(frame, el) {
    if (!editable(el)) return dc.serve && hint(notEditable(el), 3000)
    if (sel?.els.length !== 1 || primary() !== el) select(frame, [el], { quiet: true })
    editing = { frame, el, before: el.innerHTML }
    frame.el.classList.add('editing')
    el.contentEditable = 'true'
    el.spellcheck = false
    el.focus()
    const range = frame.doc.createRange()
    range.selectNodeContents(el)
    const s = frame.doc.getSelection()
    s.removeAllRanges()
    s.addRange(range)
    frame.doc.execCommand?.('styleWithCSS', false, false)
    el.addEventListener('keydown', editKeys)
    el.addEventListener('input', onEditInput)
    draw()
    renderFloat()
  }
  const onEditInput = () => {
    draw()
    placeFloat()
  }
  function editKeys(e) {
    const single = SINGLE_LINE.has(editing.el.localName) || cs(editing.el).whiteSpace === 'nowrap'
    const mod = e.ctrlKey || e.metaKey
    if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey && single)) {
      e.preventDefault()
      stopEditing(true)
    } else if (mod && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
      e.preventDefault()
      editing.frame.doc.execCommand({ b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()])
    } else if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      const href = prompt('Link to:', 'https://')
      if (href) editing.frame.doc.execCommand('createLink', false, href)
    }
  }
  /** Wrap what is selected inside the text being edited in a span carrying one style. */
  function styleRun(prop, value) {
    if (!editing) return false
    const s = editing.frame.doc.getSelection()
    if (!s.rangeCount || s.isCollapsed) return false
    const range = s.getRangeAt(0)
    if (!editing.el.contains(range.commonAncestorContainer)) return false
    const span = editing.frame.doc.createElement('span')
    span.style.setProperty(prop, value)
    span.append(range.extractContents())
    range.insertNode(span)
    s.removeAllRanges()
    const r = editing.frame.doc.createRange()
    r.selectNodeContents(span)
    s.addRange(r)
    return true
  }
  function stopEditing(save) {
    if (!editing) return
    const { frame, el, before } = editing
    editing = null
    el.removeAttribute('contenteditable')
    el.removeAttribute('spellcheck')
    el.removeEventListener('keydown', editKeys)
    el.removeEventListener('input', onEditInput)
    frame.el?.classList.remove('editing')
    frame.doc.getSelection()?.removeAllRanges()
    const after = el.innerHTML
    if (save && after !== before) send({ op: 'inner', cv: cvOf(el), html: after },{ file: frame.file, key: frame.key })
    draw()
    renderFloat()
  }
  function addText(frame, point) {
    let el = elementAt(frame, point) || frame.doc.body
    const where = isText(el) || ['img', 'svg', 'input', 'hr', 'br'].includes(el.localName) ? 'after' : 'inside'
    if (cvOf(el) == null) return hint(notEditable(el), 3000)
    dc.setTool('select')
    send({ op: 'insert', cv: cvOf(el), where, html: '<p>Text</p>' }, {
      file: frame.file, key: frame.key,
      then: (f) => {
        // The insert answers with where the new element starts.
        const made = sel && primary()
        if (made) startEditing(f, made)
      },
    })
  }

  // ── structure ──
  function startMove(e, frame, point) {
    const el = primary()
    const positioned = ['absolute', 'fixed'].includes(cs(el).position)
    const start = { x: e.clientX, y: e.clientY }
    const left0 = parseFloat(cs(el).left) || 0
    const top0 = parseFloat(cs(el).top) || 0
    let target = null
    const vp = dc.viewport
    const move = (ev) => {
      const dx = (ev.clientX - start.x) / dc.view.z / frame.s
      const dy = (ev.clientY - start.y) / dc.view.z / frame.s
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5 && !target && !moving) return
      moving = true
      if (positioned) {
        el.style.left = `${Math.round(left0 + dx)}px`
        el.style.top = `${Math.round(top0 + dy)}px`
        draw()
        return
      }
      target = dropTarget(frame, dc.toWorld(ev.clientX, ev.clientY), el)
      dropLine = target?.line ?? null
      draw()
    }
    let moving = false
    const up = () => {
      vp.removeEventListener('pointermove', move, true)
      removeEventListener('pointerup', up, true)
      dropLine = null
      if (!moving) return draw()
      if (positioned) return send({ op: 'style', cv: cvOf(el), props: { left: el.style.left, top: el.style.top } })
      draw()
      if (target) send({ op: 'move', cv: cvOf(el), target: cvOf(target.el), where: target.where })
    }
    vp.addEventListener('pointermove', move, true)
    addEventListener('pointerup', up, true)
  }
  /** Where a dragged element would land: before or after the sibling under the pointer, or inside an empty box. */
  function dropTarget(f, p, dragged) {
    const l = local(f, p)
    let t = f.doc.elementFromPoint(l.x, l.y)
    if (!t || dragged.contains(t)) return null
    t = climb(t)
    while (t && t.parentElement && !t.parentElement.contains(dragged) && t.parentElement.localName !== 'body' && t.parentElement.children.length === 1) t = t.parentElement
    if (!t || t === dragged || t.contains(dragged) || cvOf(t) == null || ['body', 'html'].includes(t.localName)) return null
    const r = t.getBoundingClientRect()
    const empty = !t.children.length && !t.textContent.trim() && !['img', 'svg', 'input', 'hr'].includes(t.localName)
    const s = f.s * dc.view.z
    const at = (x, y, w, hh) => {
      const a = dc.toScreen(f.x + x * f.s, f.y + y * f.s)
      return { x: a.x, y: a.y, w: w * s, h: hh * s }
    }
    if (empty) return { el: t, where: 'inside', line: at(r.left, r.top, r.width, r.height) }
    const pd = cs(t.parentElement)
    const row = pd.display.includes('flex') && !pd.flexDirection.startsWith('column') || pd.display.includes('grid') && r.width < t.parentElement.getBoundingClientRect().width * 0.8 || cs(t).display.startsWith('inline')
    if (row) {
      const before = l.x < r.left + r.width / 2
      return { el: t, where: before ? 'before' : 'after', line: at(before ? r.left - 1 : r.right - 1, r.top, 2 / s, r.height) }
    }
    const before = l.y < r.top + r.height / 2
    return { el: t, where: before ? 'before' : 'after', line: at(r.left, before ? r.top - 1 : r.bottom - 1, r.width, 2 / s) }
  }
  function startResize(e, hd) {
    e.stopPropagation()
    e.preventDefault()
    const el = primary()
    const f = sel.frame
    const r = el.getBoundingClientRect()
    const start = { x: e.clientX, y: e.clientY }
    const move = (ev) => {
      const dx = (ev.clientX - start.x) / dc.view.z / f.s
      const dy = (ev.clientY - start.y) / dc.view.z / f.s
      const sx = hd.includes('w') ? -1 : hd.includes('e') ? 1 : 0
      const sy = hd.includes('n') ? -1 : hd.includes('s') ? 1 : 0
      if (sx) el.style.width = `${Math.max(1, Math.round(r.width + sx * dx))}px`
      if (sy) el.style.height = `${Math.max(1, Math.round(r.height + sy * dy))}px`
      draw()
    }
    const up = () => {
      removeEventListener('pointermove', move, true)
      removeEventListener('pointerup', up, true)
      const props = {}
      if (/[ew]/.test(hd)) props.width = el.style.width
      if (/[ns]/.test(hd)) props.height = el.style.height
      send({ op: 'style', cv: cvOf(el), props })
    }
    addEventListener('pointermove', move, true)
    addEventListener('pointerup', up, true)
  }
  const needEditable = () => {
    if (!sel) return false
    if (!sel.els.every(editable)) {
      if (dc.serve) hint(notEditable(primary()), 3000)
      return false
    }
    return true
  }
  const ops = {
    duplicate: () => needEditable() && send({ op: 'duplicate', cv: cvOf(primary()) }),
    remove: () => {
      if (!needEditable()) return
      if (sel.els.some((x) => x.localName === 'body')) return hint('The body stays', 1500)
      send({ op: 'delete', cv: sel.els.map(cvOf) })
    },
    group: (style, name) => {
      if (!needEditable()) return
      const parent = primary().parentElement
      if (!sel.els.every((x) => x.parentElement === parent)) return hint('Only elements side by side in one parent group together', 3000)
      send({ op: 'wrap', cv: sel.els.map(cvOf), tag: 'div', style, name })
    },
    ungroup: () => {
      if (!needEditable()) return
      if (sel.els.length !== 1 || !primary().children.length) return hint('Select one element that holds others to ungroup it', 2500)
      send({ op: 'unwrap', cv: cvOf(primary()) })
    },
    wrapIn: (kind) => ops.group({ row: 'display: flex; flex-direction: row; gap: 8px', column: 'display: flex; flex-direction: column; gap: 8px', grid: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px' }[kind], { row: 'Row', column: 'Column', grid: 'Grid' }[kind]),
    copy: async () => {
      if (!sel) return
      const el = primary()
      let html = el.outerHTML.replace(/\s+data-cv="\d+"/g, '')
      if (dc.serve && cvOf(el) != null) {
        try {
          const res = await fetch(`/api/source?f=${encodeURIComponent(sel.frame.file)}&cv=${cvOf(el)}`)
          const body = await res.json()
          if (body.html) html = body.html
        } catch {}
      }
      clip = html
      try { await navigator.clipboard.writeText(html) } catch {}
      hint('Copied', 900)
    },
    paste: () => {
      if (!clip) return hint('Nothing copied yet', 1200)
      if (!needEditable()) return
      const el = primary()
      send({ op: 'insert', cv: cvOf(el), where: el.localName === 'body' ? 'inside' : 'after', html: clip })
    },
    nudge: (dx, dy, alt) => {
      if (!needEditable()) return
      const el = primary()
      if (['absolute', 'fixed', 'relative', 'sticky'].includes(cs(el).position) && !alt) {
        const left = (parseFloat(cs(el).left) || 0) + dx
        const top = (parseFloat(cs(el).top) || 0) + dy
        return setStyle({ left: `${Math.round(left)}px`, top: `${Math.round(top)}px` })
      }
      if (!alt) return hint('In flow it moves by its order: hold Alt to move it one place', 2000)
      const prev = dx < 0 || dy < 0
      const sib = prev ? el.previousElementSibling : el.nextElementSibling
      if (!sib || cvOf(sib) == null) return
      send({ op: 'move', cv: cvOf(el), target: cvOf(sib), where: prev ? 'before' : 'after' })
    },
  }
  let clip = null

  // ── keys ──
  hooks.onKey = (e) => {
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (mod && k === 'z') {
      e.preventDefault()
      undo(e.shiftKey)
      return true
    }
    if (mod && k === 'y') {
      e.preventDefault()
      undo(true)
      return true
    }
    const el = primary()
    if (!sel || !el) return false
    if (mod && k === 'd') ops.duplicate()
    else if (mod && k === 'g') e.shiftKey ? ops.ungroup() : ops.group()
    else if (mod && k === 'c') ops.copy()
    else if (mod && k === 'v') ops.paste()
    else if (mod) return false
    else if (e.key === 'Delete' || e.key === 'Backspace') ops.remove()
    else if (e.key === 'Escape') {
      const up = el.parentElement
      if (!up || el.localName === 'body' || up.localName === 'html') select(null, [])
      else select(sel.frame, [up])
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        if (el.parentElement && el.localName !== 'body') select(sel.frame, [el.parentElement])
      } else if (isText(el) && editable(el)) startEditing(sel.frame, el)
      else {
        const kid = [...el.children].find((c) => !SKIP.has(c.localName))
        if (kid) select(sel.frame, [kid])
      }
    } else if (e.key === 'Tab') {
      const list = [...(el.parentElement?.children ?? [])].filter((c) => !SKIP.has(c.localName))
      const i = list.indexOf(el)
      const next = list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length]
      if (next) select(sel.frame, [next])
    } else if (e.key.startsWith('Arrow')) {
      const step = e.shiftKey ? 10 : 1
      ops.nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0, e.altKey)
    } else return false
    e.preventDefault()
    return true
  }

  // ── the floating toolbar ──
  const rgbHex = (c) => {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(c || '')
    if (!m) return /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#000000'
    return `#${[m[1], m[2], m[3]].map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('')}`
  }
  /** The value every selected copy shares, or 'Mixed'. */
  const shared = (prop) => {
    const vals = [...new Set(sel.els.filter(live).map((el) => cs(el).getPropertyValue(prop)))]
    return vals.length === 1 ? vals[0] : 'Mixed'
  }
  function colorButton(title, prop, value, onPick) {
    const input = h('input', { type: 'color', value: rgbHex(value), 'aria-label': title })
    input.addEventListener('change', () => onPick(input.value))
    return h('label', { class: 'fbtn swatch-btn', title }, h('span', { class: 'chip', style: `background:${value === 'Mixed' ? 'linear-gradient(135deg,#888 50%,#444 50%)' : value}` }), input)
  }
  function renderFloat() {
    floatBar.replaceChildren()
    const el = primary()
    if (!el || !sel.frame.doc) {
      floatBar.classList.remove('open')
      return
    }
    const canEdit = sel.els.every(editable)
    const parts = []
    const text = isText(el)
    const boxy = !text || cs(el).backgroundColor !== 'rgba(0, 0, 0, 0)' || ['a', 'button'].includes(el.localName) && cs(el).display !== 'inline'
    if (text && canEdit) {
      const cls = el.classList[0]
      const label = cls ? `.${cls}` : `${shared('font-family').split(',')[0].replace(/["']/g, '')} · ${shared('font-size')}`
      parts.push(h('button', { type: 'button', class: 'fbtn wide', title: 'Text style', onclick: (e) => textStyles(e.currentTarget) }, label, h('span', { class: 'caret' }, '▾')))
      parts.push(colorButton('Text colour', 'color', shared('color'), (v) => (styleRun('color', v) || setStyle({ color: v }))))
      const bold = Number(shared('font-weight')) >= 600
      parts.push(h('button', { type: 'button', class: 'fbtn', title: 'Bold', 'aria-pressed': String(bold), onclick: () => (editing ? editing.frame.doc.execCommand('bold') : setStyle({ 'font-weight': bold ? '400' : '700' })) }, h('b', {}, 'B')))
      const italic = shared('font-style') === 'italic'
      parts.push(h('button', { type: 'button', class: 'fbtn', title: 'Italic', 'aria-pressed': String(italic), onclick: () => (editing ? editing.frame.doc.execCommand('italic') : setStyle({ 'font-style': italic ? '' : 'italic' })) }, h('i', {}, 'I')))
      const under = shared('text-decoration-line').includes('underline')
      parts.push(h('button', { type: 'button', class: 'fbtn', title: 'Underline', 'aria-pressed': String(under), onclick: () => (editing ? editing.frame.doc.execCommand('underline') : setStyle({ 'text-decoration': under ? 'none' : 'underline' })) }, h('u', {}, 'U')))
      parts.push(h('button', { type: 'button', class: 'fbtn', title: 'Link', onclick: link }, dc.icon('link')))
      parts.push(h('button', { type: 'button', class: 'fbtn', title: 'List', onclick: list }, '☰'))
      const ta = shared('text-align')
      parts.push(h('button', { type: 'button', class: 'fbtn', title: `Align: ${ta}`, onclick: (e) => dc.openMenu(e.currentTarget, ['left', 'center', 'right', 'justify'].map((a) => ({ label: a[0].toUpperCase() + a.slice(1), tick: ta === a || (a === 'left' && ta === 'start'), run: () => setStyle({ 'text-align': a }) }))) }, alignGlyph(['center', 'right', 'justify'].includes(ta) ? ta : 'left')))
    }
    if (boxy && canEdit) {
      if (text) parts.push(h('span', { class: 'sep' }))
      parts.push(colorButton('Fill', 'background-color', shared('background-color'), (v) => setStyle({ 'background-color': v })))
      const d = shared('display')
      parts.push(h('button', { type: 'button', class: 'fbtn', title: `Layout: ${d}`, onclick: (e) => dc.openMenu(e.currentTarget, [
        { label: 'Block', tick: d === 'block', run: () => setStyle({ display: 'block' }) },
        { label: 'Flex row', tick: d.includes('flex') && !shared('flex-direction').startsWith('column'), run: () => setStyle({ display: d.startsWith('inline') ? 'inline-flex' : 'flex', 'flex-direction': 'row' }) },
        { label: 'Flex column', tick: d.includes('flex') && shared('flex-direction').startsWith('column'), run: () => setStyle({ display: d.startsWith('inline') ? 'inline-flex' : 'flex', 'flex-direction': 'column' }) },
        { label: 'Grid', tick: d.includes('grid'), run: () => setStyle({ display: 'grid' }) },
        '-',
        { label: 'Wrap in flex row', run: () => ops.wrapIn('row') },
        { label: 'Wrap in flex column', run: () => ops.wrapIn('column') },
        { label: 'Wrap in grid', run: () => ops.wrapIn('grid') },
      ]) }, '▦'))
      parts.push(numberButton('Corner radius', '◜', 'border-radius', shared('border-top-left-radius')))
      parts.push(numberButton('Padding', '⊡', 'padding', shared('padding-top')))
    }
    if (canEdit) parts.push(h('span', { class: 'sep' }))
    // The owner locks a part of the prototype: it and everything in it stay as they are.
    if (dc.owner && sel.els.length === 1 && cvOf(el) != null && !fileLocked(sel.frame.file)) {
      const own = el.hasAttribute('data-locked')
      const inLocked = !own && !!el.parentElement?.closest('[data-locked]')
      if (!inLocked) parts.push(h('button', { type: 'button', class: `fbtn${own ? ' on' : ''}`, title: own ? 'Locked: click to unlock' : 'Lock this part: nobody changes, moves or deletes it', 'aria-pressed': String(own), onclick: () => send({ op: 'attr', cv: cvOf(el), name: 'data-locked', value: own ? null : 'true' }) }, dc.icon(own ? 'lock' : 'unlock')))
    } else if (lockedEl(el)) parts.push(h('span', { class: 'fbtn', title: notEditable(el) }, dc.icon('lock')))
    if (dc.commenting) parts.push(h('button', { type: 'button', class: 'fbtn', title: 'Comment on it', onclick: () => { const t = hooks.selectionTarget(); if (t) dc.commentOn(t) } }, dc.icon('comment')))
    parts.push(h('button', { type: 'button', class: 'fbtn', title: 'More', onclick: (e) => more(e.currentTarget) }, '…'))
    floatBar.append(...parts)
    floatBar.classList.add('open')
    placeFloat()
  }
  const alignGlyph = (a) => h('span', { class: 'align-glyph', 'data-a': a }, h('i'), h('i'), h('i'))
  function numberButton(title, glyph, prop, value) {
    return h('button', { type: 'button', class: 'fbtn', title: `${title}: ${value}`, onclick: (e) => {
      const v = prompt(`${title} (px, or any CSS value):`, value === 'Mixed' ? '' : value)
      if (v == null) return
      setStyle({ [prop]: /^\d+(\.\d+)?$/.test(v.trim()) ? `${v.trim()}px` : v.trim() })
    } }, glyph)
  }
  function placeFloat() {
    if (!floatBar.classList.contains('open') || !sel?.frame.doc || !primary()?.isConnected) return
    const b = rectOn(sel.frame, primary())
    const w = floatBar.offsetWidth
    let top = b.y - floatBar.offsetHeight - 30
    if (top < 56) top = b.y + b.h + 10
    floatBar.style.left = `${Math.max(8, Math.min(innerWidth - w - 8 - (document.body.classList.contains('panel-open') && innerWidth > 640 ? 320 : 0), b.x))}px`
    floatBar.style.top = `${Math.min(innerHeight - 100, Math.max(56, top))}px`
  }
  /** The text styles the prototype already uses: each tag and class pairing that holds text, with its font. */
  function textStyles(anchor) {
    const doc = sel.frame.doc
    const seen = new Map()
    for (const el of doc.body.querySelectorAll('*')) {
      if (!ownText(el)) continue
      const key = `${el.localName}${el.classList[0] ? `.${el.classList[0]}` : ''}`
      if (seen.has(key)) continue
      const c = cs(el)
      seen.set(key, { family: c.fontFamily, size: c.fontSize, weight: c.fontWeight, line: c.lineHeight, spacing: c.letterSpacing })
      if (seen.size > 30) break
    }
    dc.openMenu(anchor, [...seen].map(([key, s]) => ({
      label: `${key} · ${s.family.split(',')[0].replace(/["']/g, '')} ${s.size} ${s.weight}`,
      run: () => setStyle({ 'font-family': s.family, 'font-size': s.size, 'font-weight': s.weight, 'line-height': s.line, 'letter-spacing': s.spacing }),
    })))
  }
  function link() {
    const el = primary()
    if (editing) {
      const href = prompt('Link to:', 'https://')
      if (href) editing.frame.doc.execCommand('createLink', false, href)
      return
    }
    if (!needEditable()) return
    if (el.localName === 'a') {
      const href = prompt('Link to (empty to remove the address):', el.getAttribute('href') || '')
      if (href != null) send({ op: 'attr', cv: cvOf(el), name: 'href', value: href })
      return
    }
    const href = prompt('Link to:', '')
    if (!href) return
    const inner = el.innerHTML.replace(/\s+data-cv="\d+"/g, '')
    send({ op: 'inner', cv: cvOf(el), html: `<a href="${href.replace(/"/g, '&quot;')}">${inner}</a>` })
  }
  function list() {
    const el = primary()
    if (!needEditable()) return
    if (el.localName === 'ul' || el.localName === 'ol') {
      const html = el.outerHTML.replace(/\s+data-cv="\d+"/g, '').replace(/^<(ul|ol)/, (_, t) => `<${t === 'ul' ? 'ol' : 'ul'}`).replace(/<\/(ul|ol)>$/, (_, t) => `</${t === 'ul' ? 'ol' : 'ul'}>`)
      return send({ op: 'outer', cv: cvOf(el), html })
    }
    const lines = el.innerText.split('\n').map((s) => s.trim()).filter(Boolean)
    send({ op: 'outer', cv: cvOf(el), html: `<ul>${lines.map((l) => `<li>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</li>`).join('')}</ul>` })
  }
  function more(anchor) {
    const can = sel.els.every(editable)
    dc.openMenu(anchor, [
      { label: 'Properties', run: () => dc.openPanel('properties') },
      { label: 'Code', run: () => dc.openPanel('code') },
      '-',
      ...(can
        ? [
            isText(primary()) ? { label: 'Edit text', key: 'Enter', run: () => startEditing(sel.frame, primary()) } : null,
            { label: 'Duplicate', key: 'Ctrl+D', run: ops.duplicate },
            { label: 'Group', key: 'Ctrl+G', run: () => ops.group() },
            primary().children.length ? { label: 'Ungroup', key: 'Ctrl+Shift+G', run: ops.ungroup } : null,
            { label: 'Wrap in flex row', run: () => ops.wrapIn('row') },
            { label: 'Wrap in flex column', run: () => ops.wrapIn('column') },
            { label: 'Wrap in grid', run: () => ops.wrapIn('grid') },
            { label: 'Copy', key: 'Ctrl+C', run: ops.copy },
            clip ? { label: 'Paste after it', key: 'Ctrl+V', run: ops.paste } : null,
          ]
        : []),
      sel.els.length > 1 ? { label: 'Select this one alone', run: () => select(sel.frame, [primary()]) } : null,
      copiesOf(primary()).length > 1 && sel.els.length === 1 ? { label: 'Select every copy', run: () => select(sel.frame, copiesOf(primary())) } : null,
      dc.commenting || can ? '-' : null,
      dc.commenting ? { label: 'Ask agent about it', run: () => dc.openAsk() } : null,
      can ? { label: 'Delete', key: 'Del', danger: true, run: ops.remove } : null,
    ].filter(Boolean))
  }

  // ── what panel.js works through ──
  const api = {
    get sel() { return sel },
    get editing() { return editing },
    primary, select, pick, setStyle, send, ops, undo, climb, cvOf, editable, nameOf, isText, cs, copiesOf, copiesSelector, rgbHex, shared, notEditable, anchorFor,
    hover: (frame, el) => {
      hover = el ? { frame, el } : null
      draw()
    },
    onChange: () => {},
    onHover: () => {},
    onFrameLoad: () => {},
    SKIP,
  }
  dc.editor = api
})()
