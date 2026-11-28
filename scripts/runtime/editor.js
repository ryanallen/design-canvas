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
  /** An element's box as drawn. A group in a grid or flex row has none of its own (`display: contents`, so grouping
   *  moves nothing): its box is the one around what it holds. */
  // An element turned or mirrored by its own rotate, scale or transform is as wide and high as it is laid out, not as
  // the box drawn round it, as Figma's W and H read on a rotated layer.
  const turned = (el) => el.offsetWidth != null && ['rotate', 'scale', 'transform'].some((p) => cs(el)[p] !== 'none')
  const sizeOf = (el) => (turned(el) ? { width: el.offsetWidth, height: el.offsetHeight } : boxOf(el))
  function boxOf(el) {
    if (cs(el).display !== 'contents') return el.getBoundingClientRect()
    const rs = [...el.children].map(boxOf).filter((r) => r.width || r.height)
    if (!rs.length) return el.getBoundingClientRect()
    const left = Math.min(...rs.map((r) => r.left))
    const top = Math.min(...rs.map((r) => r.top))
    const right = Math.max(...rs.map((r) => r.right))
    const bottom = Math.max(...rs.map((r) => r.bottom))
    return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top }
  }
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
    // The one asked about first, so it stays the one the toolbar and panel speak of.
    return [el, ...[...el.ownerDocument.querySelectorAll(el.localName)].filter((x) => x !== el && sameKind(x, el))]
  }
  /** The component copy an element is in, nearest first (`data-component`), and every copy of it in its file. */
  const componentOf = (el) => {
    for (let p = el; p && p.localName !== 'html'; p = p.parentElement) {
      const name = p.getAttribute('data-component')?.trim()
      if (name) {
        const copies = [...el.ownerDocument.querySelectorAll('[data-component]')].filter((x) => x.getAttribute('data-component').trim() === name)
        const variant = p.getAttribute('data-variant')?.trim() ?? ''
        // The copies a style change reaches: those of the same variant.
        const alike = copies.filter((x) => (x.getAttribute('data-variant')?.trim() ?? '') === variant)
        return { root: p, name, copies, variant, alike }
      }
    }
    return null
  }
  const esc = (s) => String(s).replace(/[^\w-]/g, (c) => `\\${c}`)
  /** The selector a change to several copies is written to: their tag and classes, under their parent's class. */
  function copiesSelector(el) {
    const classes = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).map((c) => `.${esc(c)}`).join('')
    const pc = (el.parentElement?.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)[0]
    return `${pc ? `.${esc(pc)} > ` : ''}${el.localName}${classes}`
  }
  /** The start of what an element says: its text nodes joined with spaces, so two blocks never run together. */
  const excerpt = (el, n = 18) => {
    const walk = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (t) => (t.parentElement?.closest('script, style, template') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) })
    let t = ''
    for (let node = walk.nextNode(); node && t.length <= n; node = walk.nextNode()) t += ` ${node.data}`
    t = t.replace(/\s+/g, ' ').trim()
    return t.length > n ? `${t.slice(0, n).trim()}…` : t
  }
  /** A layer's name: data-name, aria-label, then what it is and what it says. */
  function nameOf(el) {
    const comp = el.getAttribute('data-component')?.trim()
    if (comp) return { kind: 'component', text: `◇ ${comp}${el.getAttribute('data-variant')?.trim() ? ` / ${el.getAttribute('data-variant').trim()}` : ''}` }
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
    // A box is named by its id or class and what it says, so four cards read as four different cards.
    const said = excerpt(el)
    return { kind: 'group', text: `${el.id ? `Group #${el.id}` : el.classList[0] ? `.${el.classList[0]}` : 'Group'}${said ? ` "${said}"` : ''}` }
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
  // A click selects the one element clicked; its copies (same tag and classes under the same kind of parent) only when asked for.
  const pick = (frame, el, { add = false, copies = false } = {}) => {
    if (!el) return select(null, [])
    if (add && sel && sel.frame === frame) {
      const has = sel.els.includes(el)
      return select(frame, has ? sel.els.filter((x) => x !== el) : [...sel.els, el])
    }
    select(frame, copies ? copiesOf(el) : [el])
  }
  const local = (f, p) => ({ x: (p.x - f.x) / f.s, y: (p.y - f.y) / f.s })
  const elementAt = (f, p) => {
    if (!f?.doc) return null
    const l = local(f, p)
    return climb(f.doc.elementFromPoint(l.x, l.y))
  }

  // ── what a plain click works ──
  const ACTIVE = 'a[href], button, input, select, textarea, label, summary'
  const actionAt = (f, p) => {
    if (!f?.doc) return null
    const l = local(f, p)
    return f.doc.elementFromPoint(l.x, l.y)?.closest?.(ACTIVE) ?? null
  }
  function workIt(f, el) {
    if (el.localName === 'a') {
      const href = el.getAttribute('href') ?? ''
      if (href.startsWith('#')) return el.click()
      const to = /^([^:?#]+\.html)(#.*)?$/i.exec(href)
      if (to) {
        const file = to[1].replace(/^\.\//, '')
        const hash = (to[2] ?? '').slice(1)
        const all = dc.allFrames
        const frame = all.find((x) => x.file === file && (x.hash || '') === hash) ?? all.find((x) => x.file === file)
        return frame ? dc.showFrame(frame) : hint(`${file} is not on this canvas`, 2500)
      }
      if (/^(https?:|mailto:|tel:)/i.test(href)) return window.open(el.href, '_blank', 'noopener')
      return hint(`${href} goes nowhere from a canvas`, 2500)
    }
    if (/^(input|select|textarea)$/.test(el.localName) && !/^(checkbox|radio|button|submit|reset)$/i.test(el.type)) return el.focus()
    el.click()
  }

  // ── drawing the selection on the board ──
  const rectOn = (f, el) => {
    const r = boxOf(el)
    const a = dc.toScreen(f.x + r.left * f.s, f.y + r.top * f.s)
    const k = f.s * dc.view.z
    return { x: a.x, y: a.y, w: r.width * k, h: r.height * k, r }
  }
  let dropLine = null
  let dragGhost = null
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
          // The size of what is selected: of several, the box round them all, as Figma's selection reads.
          const rs = sel.els.map(boxOf)
          const w = sel.els.length > 1 ? Math.max(...rs.map((x) => x.right)) - Math.min(...rs.map((x) => x.left)) : sizeOf(el).width
          const ht = sel.els.length > 1 ? Math.max(...rs.map((x) => x.bottom)) - Math.min(...rs.map((x) => x.top)) : sizeOf(el).height
          one.append(h('div', { class: 'ov-tag' }, `${n.text}${sel.els.length > 1 ? ` · ${sel.els.length} ${everyCopy() ? 'copies' : 'selected'}` : ''}`, h('span', {}, `${Math.round(w)} × ${Math.round(ht)}`)))
          if (sel.els.length === 1 && editable(el) && !editing) {
            for (const hd of ['nw', 'ne', 'sw', 'se', 'e', 's']) one.append(h('div', { class: `handle ${hd}`, 'data-h': hd, onpointerdown: (e) => startResize(e, hd) }))
            // A mesh fill's points, each where its color sits, to drag.
            const grid = gridOf(el)
            if (grid) {
              // Its lattice drawn: the lines between points, then the points.
              const at = (p) => [p[0] * b.w, p[1] * b.h]
              const segs = []
              for (let i = 0; i < grid.rows; i++) for (let j = 0; j < grid.cols; j++) {
                const k = i * grid.cols + j
                if (j < grid.cols - 1) segs.push([at(grid.pts[k]), at(grid.pts[k + 1])])
                if (i < grid.rows - 1) segs.push([at(grid.pts[k]), at(grid.pts[k + grid.cols])])
              }
              const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
              svg.setAttribute('class', 'mesh-lines')
              svg.setAttribute('width', b.w)
              svg.setAttribute('height', b.h)
              svg.innerHTML = segs.map(([p, q]) => `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}"/>`).join('')
              one.append(svg)
              grid.pts.forEach((p, k) => one.append(h('div', { class: 'mesh-pt grid', 'data-i': k, title: 'Drag to bend the color; click to pick its color', style: `left:${p[0] * 100}%;top:${p[1] * 100}%;background:${p[2]}`, onpointerdown: (e) => startGridDrag(e, el, k) })))
            }
            const mesh = grid ? null : meshOf(cs(el).backgroundImage)
            if (mesh) mesh.forEach((p, k) => one.append(h('div', { class: 'mesh-pt', 'data-i': k, title: 'Drag to move this color', style: `left:${p.x}%;top:${p.y}%;background:${p.color}`, onpointerdown: (e) => startMeshDrag(e, el, k) })))
          }
        }
        overlay.append(one)
      })
    }
    if (dragGhost) overlay.append(h('div', { class: 'ov ghost', style: box(dragGhost) }, h('span', {}, dragGhost.name)))
    if (dropLine) overlay.append(h('div', { class: 'ov drop', style: box(dropLine) }))
    if (measuring && sel?.els.length === 1 && hover && hover.frame === sel.frame && hover.el !== primary() && live(hover.el)) measure(sel.frame, primary(), hover.el)
  }
  // ── measure: Alt held over another element shows how far it is from the selection, in the prototype's own pixels ──
  let measuring = false
  function measure(f, a, b) {
    const A = boxOf(a)
    const B = boxOf(b)
    const at = (x, y) => dc.toScreen(f.x + x * f.s, f.y + y * f.s)
    const lines = []
    /** A line across (y fixed) or down (x fixed) from p to q, labeled with its length. */
    const line = (horiz, fixed, p, q) => {
      if (Math.round(Math.abs(q - p)) < 1) return
      const [s, e] = [Math.min(p, q), Math.max(p, q)]
      const a1 = horiz ? at(s, fixed) : at(fixed, s)
      const a2 = horiz ? at(e, fixed) : at(fixed, e)
      lines.push(h('div', { class: `ov measure ${horiz ? 'h' : 'v'}`, style: horiz ? `left:${a1.x}px;top:${a1.y}px;width:${a2.x - a1.x}px` : `left:${a1.x}px;top:${a1.y}px;height:${a2.y - a1.y}px` },
        h('span', { class: 'measure-n' }, String(Math.round(e - s)))))
    }
    const inside = (o, i) => i.left >= o.left && i.right <= o.right && i.top >= o.top && i.bottom <= o.bottom
    if (inside(B, A) || inside(A, B)) {
      // One holds the other: its distance to each of the outer one's sides.
      const [i, o] = inside(B, A) ? [A, B] : [B, A]
      const my = (i.top + i.bottom) / 2
      const mx = (i.left + i.right) / 2
      line(true, my, o.left, i.left)
      line(true, my, i.right, o.right)
      line(false, mx, o.top, i.top)
      line(false, mx, i.bottom, o.bottom)
    } else {
      // Apart: the gap across and the gap down, drawn where they face each other.
      const overlapY = [Math.max(A.top, B.top), Math.min(A.bottom, B.bottom)]
      const overlapX = [Math.max(A.left, B.left), Math.min(A.right, B.right)]
      const y = overlapY[0] < overlapY[1] ? (overlapY[0] + overlapY[1]) / 2 : (A.top + A.bottom) / 2
      const x = overlapX[0] < overlapX[1] ? (overlapX[0] + overlapX[1]) / 2 : (A.left + A.right) / 2
      if (B.left >= A.right) line(true, y, A.right, B.left)
      else if (A.left >= B.right) line(true, y, B.right, A.left)
      if (B.top >= A.bottom) line(false, x, A.bottom, B.top)
      else if (A.top >= B.bottom) line(false, x, B.bottom, A.top)
    }
    const hb = rectOn(f, b)
    overlay.append(h('div', { class: 'ov measure-to', style: box(hb) }), ...lines)
  }
  const setMeasuring = (on) => {
    if (on === measuring) return
    measuring = on
    document.body.classList.toggle('measuring', on)
    draw()
  }
  addEventListener('keydown', (e) => e.key === 'Alt' && sel && setMeasuring(true))
  addEventListener('keyup', (e) => e.key === 'Alt' && setMeasuring(false))
  addEventListener('blur', () => setMeasuring(false))
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
    // A plain click works the page: links go where they point, buttons, checkboxes and fields act.
    // Ctrl or ⌘ (or Shift, Alt) selects instead, to edit it.
    if (!(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)) {
      const act = actionAt(frame, point)
      if (act) {
        workIt(frame, act)
        return true
      }
    }
    const deep = elementAt(frame, point)
    // Click selects the whole block: a press inside the block selected drags that block, as Figma drags a selected group from
    // any of its layers; only a click that does not move goes one level in.
    const cur = sel?.frame === frame && sel.els.length === 1 ? primary() : null
    if (dc.store?.get('clickDepth') === 'outer' && cur && deep && cur !== deep && cur.contains(deep) && !e.shiftKey && !e.altKey && editable(cur) && cur.localName !== 'body') {
      const next = byDepth(frame, deep)
      startMove(e, frame, point, () => pick(frame, next))
      return true
    }
    const el = byDepth(frame, deep)
    if (!el) return true
    const already = sel && sel.frame === frame && sel.els.includes(el)
    if (e.shiftKey) pick(frame, el, { add: true })
    else if (!already || e.altKey) pick(frame, el, { copies: e.altKey })
    // A press that moves drags the selection: a reorder in flow, or left and top when positioned.
    if (!e.shiftKey && sel && editable(primary()) && sel.els.length === 1 && primary().localName !== 'body') startMove(e, frame, point)
    return true
  }
  // A right-click in a prototype: what is under it is selected unless it is already in the selection (so a right-click
  // on one of several keeps them all), and its menu opens there.
  hooks.onContextMenu = (e, { frame, point }) => {
    if (!frame?.doc || dc.tool !== 'select') return false
    if (editing) stopEditing(true)
    const deep = elementAt(frame, point)
    if (!deep) return false
    const inside = sel?.frame === frame && sel.els.some((x) => x === deep || x.contains(deep))
    if (!inside) {
      const el = byDepth(frame, deep)
      if (!el) return false
      pick(frame, el)
    }
    if (!sel) return false
    more({ x: e.clientX, y: e.clientY })
    return true
  }
  /** With "Click selects the whole block" (as Figma): a click outside the selection picks the outermost block holding the
      element under the pointer, passing over wrappers that fill the page; a click inside the selection picks the
      next one in on the way to it. Otherwise the element under the pointer, as before. */
  function byDepth(frame, deep) {
    if (!deep || dc.store?.get('clickDepth') !== 'outer') return deep
    const body = frame.doc.body
    const chain = []
    for (let k = deep; k && k !== body && k.localName !== 'html'; k = k.parentElement) chain.unshift(k)
    if (!chain.length) return deep
    const cur = sel?.frame === frame ? primary() : null
    const i = cur ? chain.indexOf(cur) : -1
    if (i >= 0) return chain[Math.min(i + 1, chain.length - 1)]
    // From the top down, past any block nearly as big as the page itself (a <main> or a wrapper).
    const page = body.getBoundingClientRect()
    let j = 0
    while (j < chain.length - 1) {
      const r = chain[j].getBoundingClientRect()
      if (r.width * r.height < page.width * page.height * 0.6) break
      j++
    }
    return chain[j]
  }
  hooks.onHover = (e, info) => {
    document.body.classList.toggle('over-action', !!(e && info?.frame && dc.tool === 'select' && !editing && !(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) && actionAt(info.frame, info.point)))
    if (!e || !info?.frame || dc.tool !== 'select' || editing) {
      if (hover) {
        hover = null
        draw()
      }
      return
    }
    // Outlined is what a click would pick, whichever the click setting.
    const el = byDepth(info.frame, elementAt(info.frame, info.point))
    if (el !== hover?.el) {
      hover = el ? { frame: info.frame, el } : null
      draw()
      api.onHover(hover)
    }
  }
  hooks.climb = (el) => climb(el)
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
      if (k) pick(frame, k)
    }
  }
  hooks.onEmptyClick = () => select(null, [])
  hooks.onFramePick = (f) => {
    if (f.doc) pick(f, f.doc.body)
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
  // The whole screen selected (its label clicked): its key, for what the board does with screens.
  hooks.selectedScreen = () => (sel && sel.els.length === 1 && sel.els[0].localName === 'body' ? sel.frame.key : null)
  /** The box round the selected elements on the board, for zoom to selection. */
  hooks.selectionBox = () => {
    const els = sel?.els.filter(live) ?? []
    if (!els.length) return null
    const f = sel.frame
    const rs = els.map((el) => boxOf(el))
    const x = Math.min(...rs.map((r) => r.left))
    const y = Math.min(...rs.map((r) => r.top))
    return { x: f.x + x * f.s, y: f.y + y * f.s, w: (Math.max(...rs.map((r) => r.right)) - x) * f.s, h: (Math.max(...rs.map((r) => r.bottom)) - y) * f.s }
  }
  // Each selected element's own box on the board, for others in the room to see what is selected.
  hooks.selectionBoxes = () => {
    if (!sel) return []
    const f = sel.frame
    return sel.els.filter(live).slice(0, 50).map((el) => { const r = boxOf(el); return { x: f.x + r.left * f.s, y: f.y + r.top * f.s, w: (r.right - r.left) * f.s, h: (r.bottom - r.top) * f.s } })
  }
  hooks.selectionTarget = () => {
    const el = primary()
    if (!el) return null
    const b = boxOf(el)
    const a = anchorFor(sel.frame, el, 0, 0)
    return { frame: sel.frame, file: sel.frame.file, anchor: a, wx: sel.frame.x + b.left * sel.frame.s, wy: sel.frame.y + b.top * sel.frame.s, label: `${nameOf(el).text} in ${sel.frame.file}` }
  }
  hooks.onOutsideChange = () => {}
  // Words pasted with an element selected: a paragraph each line, after it, or inside it when it holds others.
  hooks.placeText = (text) => {
    const el = primary()
    if (!sel || !el) return
    if (!editable(el) || cvOf(el) == null) return hint(notEditable(el), 3000)
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const html = text.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('\n')
    const where = isText(el) || ['img', 'svg', 'input', 'hr', 'br', 'video', 'picture', 'canvas', 'button', 'a'].includes(el.localName) ? 'after' : 'inside'
    send({ op: 'insert', cv: cvOf(el), where, html })
  }
  // A picture saved into the folder, put into a prototype: dropped on an <img> (or pasted with one selected), it
  // takes that one's place, its srcset going with the old picture, as an image dropped on a Figma shape fills it;
  // anywhere else a new <img> goes after the element there, or inside it when it holds others.
  hooks.placePicture = (src, into) => {
    const frame = into.selected ? sel?.frame : into.frame
    const el = into.selected ? primary() : elementAt(frame, into.point) || frame?.doc?.body
    if (!frame || !el) return
    if (!editable(el) || cvOf(el) == null) return hint(notEditable(el), 3000)
    const rel = `${'../'.repeat(frame.file.split('/').length - 1)}${src}`
    if (el.localName === 'img') return send({ op: 'styles', items: [{ cv: cvOf(el), props: {}, attrs: { src: rel, srcset: null } }] }, { file: frame.file, key: frame.key })
    const where = isText(el) || ['img', 'svg', 'input', 'hr', 'br', 'video', 'picture', 'canvas'].includes(el.localName) ? 'after' : 'inside'
    send({ op: 'insert', cv: cvOf(el), where, html: `<img src="${rel}" alt="" style="max-width: 100%">` }, { file: frame.file, key: frame.key })
  }
  // The file being typed in changed (an agent wrote it): kept, and drawn when the typing ends, so the words go on.
  hooks.holdFile = (file, html) => {
    if (editing?.frame.file !== file) return false
    editing.held = html
    return true
  }
  /** Where the element typed in is in the file as it now is, after a change from outside while it was typed in: of
   *  the elements with its tag that held the words it held, the one at its place among them. Null when it is not
   *  there: that element itself was changed. */
  function cvIn(html, el, before) {
    const norm = (s) => s.replace(/\s+data-cv="\d+"/g, '')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const was = [...el.ownerDocument.querySelectorAll(el.localName)].filter((x) => x === el || norm(x.innerHTML) === norm(before))
    const now = [...doc.querySelectorAll(el.localName)].filter((x) => norm(x.innerHTML) === norm(before))
    const x = now[Math.min(was.indexOf(el), now.length - 1)]
    return x?.hasAttribute('data-cv') ? Number(x.getAttribute('data-cv')) : null
  }

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
    return { path: [root, ...steps].join(' > '), dx: Math.round(dx), dy: Math.round(dy), tag: el.localName, text: said(el) }
  }
  /** The start of what an element says, as an anchor keeps it. */
  // What an element says, its pieces of text joined by spaces ("Fort Point 4.8 mi", not "Fort Point4.8 mi"), as an agent reads it.
  const said = (el) => excerpt(el, 80).replace(/…$/, '').slice(0, 80)
  // Pins made before joined the pieces with nothing between: they are still found by those words.
  const saidBefore = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  const says = (el, text) => said(el) === text || saidBefore(el) === text
  /** The element a comment is pinned to: by its path, checked against what it is and says; when
      something put before it has moved it, the element of that tag saying those words. */
  function resolveAnchor(doc, path, anchor = {}) {
    const byPath = followPath(doc, path)
    if (!anchor.text || (byPath && byPath.localName === anchor.tag && says(byPath, anchor.text))) return byPath
    const same = [...doc.querySelectorAll(anchor.tag || '*')].filter((el) => says(el, anchor.text))
    return same[0] ?? byPath
  }
  function followPath(doc, path) {
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
    const r = boxOf(el)
    return { file: f.file, anchor: anchorFor(f, el, l.x - r.left, l.y - r.top) }
  }
  // Play's own page: a comment dropped on one of its elements, and the element a thread is pinned to there.
  hooks.anchorOfElement = (el, dx, dy) => anchorFor(null, el, dx, dy)
  hooks.elementOfAnchor = (doc, t) => (t.anchor ? resolveAnchor(doc, t.anchor.path, t.anchor) : null)
  hooks.anchorPoint = (t, f) => {
    if (!f.doc || !t.anchor || (t.file && t.file !== f.file)) return null
    const el = resolveAnchor(f.doc, t.anchor.path, t.anchor)
    if (!el) return null
    const r = boxOf(el)
    return { x: f.x + (r.left + Math.min(t.anchor.dx, r.width)) * f.s, y: f.y + (r.top + Math.min(t.anchor.dy, r.height)) * f.s, top: f.y + r.top * f.s, bottom: f.y + r.bottom * f.s }
  }

  // ── writing ──
  let busy = false
  /** One edit to the selected frame's file. The answer redraws every frame of that file and the selection returns. */
  async function send(edit, { file = sel?.frame.file, key = sel?.frame.key, copies = false, then, v } = {}) {
    if (!dc.serve) return
    if (!file) return
    if (fileLocked(file)) return hint('This artboard is locked', 2000)
    if (busy) return hint('Still saving the last change', 1200)
    busy = true
    // The version of the file the element was picked in: the server refuses the edit if the file has changed since.
    if (v === undefined) {
      const shown = sel?.frame.file === file && sel.frame.doc ? sel.frame : dc.allFrames?.find((f) => f.file === file && f.doc)
      v = shown?.doc.documentElement.getAttribute('data-dc-v') ?? undefined
    }
    try {
      const res = await fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file, edit, name: dc.me || 'someone', v }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Saving failed (${res.status})`)
      // Nothing to write (a sheet already linked): what was to follow the redraw follows now.
      if (body.same) {
        if (then) setTimeout(() => then(sel?.frame, sel ? primary() : null), 0)
        return
      }
      dc.noteFileEdit?.()
      if (body.linked) hint(`Made in all ${body.linked + 1} copies of the component${body.screens ? ` on ${body.screens + 1} screens` : ''}`, 1600)
      pendingSelect = { file, key, cv: body.select, copies, then }
      dc.reloadFile(file, body.html)
      // The component's copies on other screens took the change too.
      for (const [other, html] of Object.entries(body.others ?? {})) dc.reloadFile(other, html)
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
  /** One declaration of a rule in a stylesheet the prototypes link: written into that file, every frame linking it
   *  redraws, and the selection comes back. */
  async function sendSheet(sheet, selector, nth, prop, value) {
    if (!dc.serve) return
    if (busy) return hint('Still saving the last change', 1200)
    busy = true
    // Set before asking: the server tells every page of the change, and that may redraw the frames before the answer.
    const keep = sel ? { file: sel.frame.file, key: sel.frame.key, cv: cvOf(primary()), copies: sel.els.length > 1 } : null
    pendingSelect = keep
    const drop = () => { if (pendingSelect === keep) pendingSelect = null }
    try {
      const res = await fetch('/api/sheet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sheet, selector, nth, prop, value, name: dc.me || 'someone' }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Saving failed (${res.status})`)
      if (body.same) return drop()
      dc.noteFileEdit?.()
      dc.reloadSheet(body.sheet, body.text)
    } catch (err) {
      drop()
      hint(err.message, 4000)
    } finally {
      busy = false
    }
  }
  /** Hide or show elements, as Figma's eye: hidden is `display: none` on the element, so Play hides it too, with a
   *  display of its own kept in data-display to come back when it is shown; shown without one, ours comes off, or,
   *  when its class hides it, it takes the display its tag would have. One edit, one undo. */
  function setHidden(frame, els, hide) {
    const items = els.filter((x) => editable(x) && cvOf(x) != null && x.localName !== 'body').map((x) => {
      const own = x.style.getPropertyValue('display')
      if (hide) return { cv: cvOf(x), props: { display: 'none' }, attrs: own && own !== 'none' ? { 'data-display': own } : {} }
      const kept = x.getAttribute('data-display')
      if (kept) return { cv: cvOf(x), props: { display: kept }, attrs: { 'data-display': null } }
      x.style.removeProperty('display')
      const still = cs(x).display === 'none'
      if (own) x.style.setProperty('display', own)
      return { cv: cvOf(x), props: { display: still ? 'revert' : '' } }
    })
    if (!items.length) return
    send({ op: 'styles', items }, { file: frame.file, key: frame.key, then: sel?.frame === frame ? reselect() : undefined })
  }
  /** The picture of the selection, as a PNG from the server; null, with a hint, when there is none. */
  /** Every element on the element's screen with its fill, its text color (on what holds words) or its type. */
  function sameAs(el, how) {
    const k = cs(el)
    const key = (x) => {
      const c = cs(x)
      if (how === 'fill') return c.backgroundColor === 'rgba(0, 0, 0, 0)' ? null : c.backgroundColor
      // Stroke: the border on every side, width, style and color; effect: the shadow as computed.
      if (how === 'stroke') {
        const sides = ['top', 'right', 'bottom', 'left'].map((s) => (c.getPropertyValue(`border-${s}-style`) === 'none' || !parseFloat(c.getPropertyValue(`border-${s}-width`)) ? '' : `${c.getPropertyValue(`border-${s}-width`)} ${c.getPropertyValue(`border-${s}-style`)} ${c.getPropertyValue(`border-${s}-color`)}`))
        return sides.every((x) => !x) ? null : sides.join('|')
      }
      if (how === 'effect') return c.boxShadow === 'none' ? null : c.boxShadow
      const words = [...x.childNodes].some((t) => t.nodeType === 3 && t.textContent.trim())
      if (!words) return null
      return how === 'color' ? c.color : `${c.fontFamily}|${c.fontSize}|${c.fontWeight}`
    }
    const want = key(el) ?? (['fill', 'stroke', 'effect'].includes(how) ? null : how === 'color' ? k.color : `${k.fontFamily}|${k.fontSize}|${k.fontWeight}`)
    if (want == null) return []
    return [...el.ownerDocument.body.querySelectorAll('*')].filter((x) => !SKIP.has(x.localName) && live(x) && key(x) === want)
  }
  async function pngOf({ scale, type } = {}) {
    if (!dc.serve || dc.local) {
      hint('To make a picture, run the canvas from its folder with node scripts/canvas.mjs serve <folder>', 5000)
      return null
    }
    const el = primary()
    const f = sel.frame
    hint('Making the picture…', 6000)
    // In the mode the screen is seen in on the board.
    const q = new URLSearchParams({ f: f.file, w: String(Math.round(f.w)), h: String(Math.round(f.h)), ...(dc.schemeOf?.(f) !== 'auto' ? { scheme: dc.schemeOf(f) } : {}), ...(f.hash ? { hash: f.hash } : {}), ...(el.localName === 'body' || cvOf(el) == null ? {} : { cv: String(cvOf(el)) }), ...(scale ? { scale: String(scale) } : {}), ...(type ? { type } : {}) })
    const res = await fetch(`/api/png?${q}`)
    if (!res.ok) {
      hint((await res.json().catch(() => ({}))).error || 'No picture was made', 5000)
      return null
    }
    return res.blob()
  }
  /** What brings the selection as it is now back after its frame redraws: each element found again by its place,
   *  for an edit that moves nothing (a style). */
  function reselect() {
    const doc = sel.frame.doc
    const paths = sel.els.map((x) => {
      const p = []
      for (let n = x; n && n !== doc.body; n = n.parentElement) p.unshift([...n.parentElement.children].indexOf(n))
      return p
    })
    return (f) => {
      const back = paths.map((p) => p.reduce((n, i) => n?.children[i], f.doc.body)).filter(Boolean)
      if (back.length) select(f, back)
    }
  }
  /** The lines of text in the selection, each that holds words of its own (a group's headline and paragraph). */
  const textsIn = () => [...new Set(sel.els.flatMap((x) => [x, ...x.querySelectorAll('*')]))].filter((x) => ownText(x) && editable(x) && cvOf(x) != null && !['script', 'style'].includes(x.localName))
  /** A text color for a selection that is not itself text (a group, a card): every line in it takes it, over any
   *  color of its own, in one edit, as a text color on a Figma group colors every text in it. */
  function styleTexts(props) {
    const texts = textsIn()
    if (!texts.length) return
    for (const x of texts) for (const [k, v] of Object.entries(props)) x.style.setProperty(k, v)
    send({ op: 'styles', items: texts.map((x) => ({ cv: cvOf(x), props })) }, { then: reselect() })
  }
  const colorTexts = (value) => styleTexts({ color: value })
  /** Whether the selection is every copy of one kind (Alt + click, Select every copy), whose style is one rule. */
  function everyCopy() {
    if (!sel || sel.els.length < 2) return false
    const el = primary()
    if (!sel.els.every((x) => sameKind(x, el))) return false
    const all = copiesOf(el)
    return all.length === sel.els.length && all.every((x) => sel.els.includes(x))
  }
  /** A style change to the selection: inline on one element, a rule for every copy, or on each element picked. */
  function setStyle(props) {
    if (!sel) return
    const el = primary()
    if (!sel.els.every(editable)) return dc.serve && hint(notEditable(el), 3000)
    // While Properties shows a state (hover, pressed, focus), the toolbar changes that state too.
    const state = sel.els.length === 1 ? dc.stateRuleFor?.(el) : null
    if (state) return send({ op: 'rule', selector: state, props, cv: cvOf(el) })
    // Every copy selected (Alt + click, or Select every copy): one rule they all follow.
    if (everyCopy()) {
      for (const x of sel.els) for (const [k, v] of Object.entries(props)) x.style.setProperty(k, v || '')
      return send({ op: 'rule', selector: copiesSelector(el), props, cv: cvOf(el) }, { copies: true })
    }
    // Several picked by hand (Shift + click), alike or not: each takes the style itself, in one edit, and the same
    // ones stay selected, found again by their places since a style moves nothing.
    if (sel.els.length > 1) {
      for (const x of sel.els) for (const [k, v] of Object.entries(props)) x.style.setProperty(k, v || '')
      draw()
      return send({ op: 'styles', items: sel.els.map((x) => ({ cv: cvOf(x), props })) }, { then: reselect() })
    }
    for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v || '')
    draw()
    return send({ op: 'style', cv: cvOf(el), props })
  }
  const notEditable = (el) => (!dc.serve ? dc.readOnly : el && fileLocked(fileOf(el)) ? 'This artboard is locked by its owner.' : el && lockedEl(el) ? 'This part is locked by its owner.' : el && cvOf(el) == null ? 'This element is made by the prototype\'s own script, so it can be inspected and not edited.' : 'Nothing editable is selected.')
  /** Ctrl+Z: the board undoes its own last step; a prototype edit is undone by the server. */
  async function undoLast(redo) {
    if (!(await dc.boardUndo?.(redo))) undo(redo)
  }
  async function undo(redo = false) {
    if (!dc.serve) return
    // A stylesheet undone is told to every page, which may redraw the frames before this answer: the selection is
    // set to come back before asking.
    const held = sel ? { file: sel.frame.file, key: sel.frame.key, cv: cvOf(primary()), copies: sel.els.length > 1 } : null
    pendingSelect = held
    const drop = () => { if (pendingSelect === held) pendingSelect = null }
    const res = await fetch(redo ? '/api/redo' : '/api/undo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: dc.me || 'someone' }) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return drop(), hint(body.error || 'Nothing changed', 4000)
    if (body.none) return drop(), hint(redo ? 'Nothing to redo' : 'Nothing to undo', 1200)
    if (body.sheet) {
      dc.reloadSheet(body.sheet, body.text)
      return hint(redo ? 'Redone' : 'Undone', 900)
    }
    // What changed comes back selected, as Figma's undo does: the element round the change, in the screen the
    // selection was in (else the first one showing that file); with no such element, the selection as it was.
    const same = sel && sel.frame.file === body.file
    const keep = body.cv != null ? { file: body.file, key: same ? sel.frame.key : null, cv: body.cv, copies: false } : same ? { file: body.file, key: sel.frame.key, cv: cvOf(primary()), copies: sel.els.length > 1 } : null
    pendingSelect = keep
    dc.reloadFile(body.file, body.html)
    for (const [other, html] of Object.entries(body.others ?? {})) dc.reloadFile(other, html)
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
    el.addEventListener('paste', plainPaste)
    el.addEventListener('dblclick', wordOnly)
    frame.doc.addEventListener('pointerdown', pressAway, true)
    draw()
    renderFloat()
  }
  /** While typing, the frame takes the pointer (to place the caret). A press elsewhere in it ends the typing, saved,
   *  and selects what was pressed, as a click on the board would; found again by its place once the frame redraws. */
  function pressAway(e) {
    if (!editing || e.target.ownerDocument !== editing.frame.doc) return
    if ((editing.chain ?? [editing.el]).some((x) => x.contains(e.target))) return
    e.preventDefault()
    e.stopPropagation()
    const frame = editing.frame
    const doc = frame.doc
    const target = e.target.nodeType === 1 ? e.target : e.target.parentElement
    const next = target && target !== doc.body && target !== doc.documentElement ? byDepth(frame, target) : null
    const path = []
    for (let x = next; x && x !== doc.body; x = x.parentElement) path.unshift([...x.parentElement.children].indexOf(x))
    stopEditing(true, {
      now: next,
      then: next && ((f) => {
        const x = path.reduce((n, i) => n?.children[i], f.doc.body)
        if (x) select(f, [x])
      }),
    })
  }
  /** A word double-clicked while typing is the word alone: Windows takes the space after it too, so bold or a link
   *  would run on past it. */
  function wordOnly(e) {
    const s = e.currentTarget.ownerDocument.getSelection()
    if (!s.rangeCount) return
    const r = s.getRangeAt(0)
    if (r.endContainer.nodeType !== 3) return
    let end = r.endOffset
    while (end > 0 && (r.endContainer !== r.startContainer || end > r.startOffset + 1) && /\s/.test(r.endContainer.data[end - 1])) end--
    if (end !== r.endOffset) r.setEnd(r.endContainer, end)
  }
  /** Text pasted while typing comes in as words, never as another page's markup and styles. */
  function plainPaste(e) {
    const text = e.clipboardData?.getData('text/plain')
    if (text == null) return
    e.preventDefault()
    e.currentTarget.ownerDocument.execCommand('insertText', false, text)
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
    } else if (e.key === 'Enter' && !e.shiftKey && !mod) {
      e.preventDefault()
      splitAtCaret()
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && !mod && !e.shiftKey && !e.altKey && joinAtCaret(e.key === 'Backspace')) {
      e.preventDefault()
    } else if (e.key === 'Tab' && !mod && !e.altKey) {
      e.preventDefault()
      tabOut(e.shiftKey)
    } else if (mod && e.shiftKey && !e.altKey && e.code === 'KeyX') {
      e.preventDefault()
      editing.frame.doc.execCommand('strikeThrough')
    } else if (mod && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
      e.preventDefault()
      editing.frame.doc.execCommand({ b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()])
    } else if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      const at = editing
      askLink('Link to:', 'https://').then((href) => linkInPlace(at, href))
    }
  }
  /** Enter while typing: the text after the caret goes on in a new element after this one (a paragraph after a
      heading, else the same tag and attributes but the id), typed into from its start. The browser's own Enter
      would put a <div> inside the paragraph, which the file's next reader closes the paragraph before. */
  function splitAtCaret() {
    const { frame, el, before } = editing
    const doc = frame.doc
    const s = doc.getSelection()
    if (!s.rangeCount || !el.contains(s.getRangeAt(0).endContainer)) return
    const r = s.getRangeAt(0)
    r.deleteContents()
    const tail = doc.createRange()
    tail.setStart(r.endContainer, r.endOffset)
    tail.setEnd(el, el.childNodes.length)
    const box = doc.createElement('div')
    box.append(tail.extractContents())
    const clean = (html) => html.replace(/\s+data-cv="\d+"/g, '')
    const tag = /^h[1-6]$/.test(el.localName) ? 'p' : el.localName
    const attrs = tag === el.localName ? [...el.attributes].filter((a) => !['id', 'data-cv', 'contenteditable', 'spellcheck'].includes(a.name)) : []
    const empty = (html) => (html.replace(/<br\s*\/?>/g, '').trim() ? html : '<br>')
    const next = doc.createElement(tag)
    for (const a of attrs) next.setAttribute(a.name, a.value)
    next.innerHTML = empty(clean(box.innerHTML))
    if (!el.innerHTML.replace(/<br\s*\/?>/g, '').trim()) el.innerHTML = '<br>'
    el.after(next)
    // Typing goes on in the new element at once; the file gets one edit when typing ends (stopEditing).
    for (const [k, fn] of [['keydown', editKeys], ['input', onEditInput], ['paste', plainPaste]]) el.removeEventListener(k, fn)
    el.removeAttribute('contenteditable')
    el.removeAttribute('spellcheck')
    editing = { frame, el: next, before, chain: [...(editing.chain ?? [el]), next] }
    next.contentEditable = 'true'
    next.spellcheck = false
    for (const [k, fn] of [['keydown', editKeys], ['input', onEditInput], ['paste', plainPaste]]) next.addEventListener(k, fn)
    next.focus()
    const c = doc.createRange()
    c.setStart(next, 0)
    c.collapse(true)
    s.removeAllRanges()
    s.addRange(c)
    sel = { ...sel, els: [next] }
    draw()
    placeFloat()
  }
  /** Tab while typing: the typing ends, saved, and the next part beside it is selected (Shift+Tab the one before), as
      Tab does when nothing is being typed; the browser's own Tab would take the keys to a button of the canvas. */
  function tabOut(back) {
    const span = editing.chain ? editing.chain.length - 1 : 0
    const beside = (x) => {
      const list = [...(x.parentElement?.children ?? [])].filter((c) => !SKIP.has(c.localName))
      return list[(list.indexOf(x) + (back ? -1 : 1) + list.length) % list.length]
    }
    const lastOf = (x) => { for (let i = 0; i < span && x.nextElementSibling; i++) x = x.nextElementSibling; return x }
    const first = editing.chain ? editing.chain[0] : editing.el
    stopEditing(true, {
      now: beside(back ? first : lastOf(first)),
      then: (f, x) => { const to = x && beside(back ? x : lastOf(x)); if (f && to) select(f, [to]) },
    })
  }
  /** Backspace at the start of a line Enter made, or Delete at the end of the one before it, joins the two again, as
      any text editor does; typing goes on at the join. Only lines of this typing (the chain) are joined, since they
      are written as one edit when typing ends. Returns whether it joined. */
  function joinAtCaret(back) {
    const { frame, el, chain } = editing
    if (!chain) return false
    const doc = frame.doc
    const s = doc.getSelection()
    if (!s.rangeCount || !s.isCollapsed || !el.contains(s.anchorNode)) return false
    const r = s.getRangeAt(0)
    const side = doc.createRange()
    side.selectNodeContents(el)
    if (back) side.setEnd(r.startContainer, r.startOffset)
    else side.setStart(r.endContainer, r.endOffset)
    if (side.toString() !== '' || side.cloneContents().querySelector('img, svg')) return false
    const n = chain.indexOf(el)
    const [first, second] = back ? [chain[n - 1], el] : [el, chain[n + 1]]
    if (!first || !second) return false
    const bare = (x) => !x.innerHTML.replace(/<br\s*\/?>/g, '').trim()
    if (bare(first)) first.replaceChildren()
    const at = first.childNodes.length
    if (!bare(second)) first.append(...second.childNodes)
    if (!first.childNodes.length) first.innerHTML = '<br>'
    for (const [k, fn] of [['keydown', editKeys], ['input', onEditInput], ['paste', plainPaste]]) second.removeEventListener(k, fn)
    second.remove()
    const rest = chain.filter((x) => x !== second)
    if (first !== el) {
      for (const [k, fn] of [['keydown', editKeys], ['input', onEditInput], ['paste', plainPaste]]) first.addEventListener(k, fn)
      first.contentEditable = 'true'
      first.spellcheck = false
    }
    // Back to the one element first typed in: written as its words, as if Enter had not been pressed.
    editing = { ...editing, el: first, chain: rest.length > 1 ? rest : null }
    first.focus()
    const c = doc.createRange()
    c.setStart(first, Math.min(at, first.childNodes.length))
    c.collapse(true)
    s.removeAllRanges()
    s.addRange(c)
    sel = { ...sel, els: [first] }
    draw()
    placeFloat()
    return true
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
  function stopEditing(save, { now = null, then = null } = {}) {
    if (!editing) return
    const { frame, el, before, chain, held } = editing
    editing = null
    // The browser's strikethrough writes <strike>, which HTML dropped; the file gets <s>.
    for (const x of chain ?? [el]) for (const old of x.querySelectorAll('strike')) {
      const s = frame.doc.createElement('s')
      s.append(...old.childNodes)
      old.replaceWith(s)
    }
    frame.doc.removeEventListener('pointerdown', pressAway, true)
    // The file changed outside while this was typed in: the words go where the element now is in it. When the
    // element itself was changed there, nothing is written over it: the words are put on the clipboard instead.
    let cv = cvOf(chain ? chain[0] : el)
    if (held != null) {
      cv = cvIn(held, chain ? chain[0] : el, before)
      const changed = save && (chain || el.innerHTML !== before)
      if (cv == null || !changed) {
        for (const [k, fn] of [['keydown', editKeys], ['input', onEditInput], ['paste', plainPaste], ['dblclick', wordOnly]]) el.removeEventListener(k, fn)
        frame.el?.classList.remove('editing')
        const words = (chain ?? [el]).map((x) => x.innerText).join('\n')
        dc.reloadFile(frame.file, held)
        if (changed) {
          navigator.clipboard?.writeText(words).catch(() => {})
          hint(`That line was changed somewhere else while you were typing, so your words weren't saved over it. They're copied, ready to paste where they belong.`, 6000)
        }
        return
      }
    }
    // Placed in the file as it now is, the edit carries that version.
    const v = held != null ? (held.match(/data-dc-v="([^"]+)"/) ?? [])[1] : undefined
    if (chain) {
      // Split by Enter: the element first typed in is replaced by it and the ones made after it, in one edit.
      for (const [k, fn] of [['keydown', editKeys], ['input', onEditInput], ['paste', plainPaste]]) el.removeEventListener(k, fn)
      el.removeAttribute('contenteditable')
      el.removeAttribute('spellcheck')
      frame.el?.classList.remove('editing')
      frame.doc.getSelection()?.removeAllRanges()
      const html = chain.map((x) => x.outerHTML.replace(/\s+data-cv="\d+"/g, '').replace(/^(<[^>]*?)\s+style=""/, '$1')).join('')
      const at = chain.indexOf(el)
      send({ op: 'outer', cv, html }, {
        file: frame.file, key: frame.key, v,
        then: then ?? ((f, first) => {
          let x = first
          for (let i = 0; i < at && x; i++) x = x.nextElementSibling
          if (x) select(f, [x])
        }),
      })
      return
    }
    el.removeAttribute('contenteditable')
    el.removeAttribute('spellcheck')
    el.removeEventListener('keydown', editKeys)
    el.removeEventListener('input', onEditInput)
    el.removeEventListener('paste', plainPaste)
    el.removeEventListener('dblclick', wordOnly)
    frame.el?.classList.remove('editing')
    frame.doc.getSelection()?.removeAllRanges()
    const after = el.innerHTML
    if (save && after !== before) send({ op: 'inner', cv, html: after }, { file: frame.file, key: frame.key, then, v })
    else if (now) select(frame, [now])
    draw()
    renderFloat()
  }
  function addText(frame, point) {
    let el = elementAt(frame, point) || frame.doc.body
    const where = isText(el) || ['img', 'svg', 'input', 'hr', 'br'].includes(el.localName) ? 'after' : 'inside'
    // A locked part (or one inside it, or a locked screen) takes no new text, beside it or in it: said here, not sent.
    if (!editable(el)) return hint(notEditable(el), 3000)
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
  /** Whether the element a drag holds is gone from what is drawn: its screen was drawn again (an edit just made, or
   *  the file changed outside) while the drag went on. */
  const lost = (frame, el) => !el.isConnected || !el.ownerDocument.defaultView || el.ownerDocument !== frame.doc
  function startMove(e, frame, point, still) {
    const el = primary()
    const positioned = ['absolute', 'fixed'].includes(cs(el).position)
    const start = { x: e.clientX, y: e.clientY }
    const left0 = parseFloat(cs(el).left) || 0
    const top0 = parseFloat(cs(el).top) || 0
    let target = null
    const vp = dc.viewport
    // What is dragged follows the pointer as an outline, its place in the page dimmed, as Figma carries a layer.
    const from = positioned ? null : rectOn(frame, el)
    const opacity0 = el.style.opacity
    const move = (ev) => {
      // The screen was drawn again under the drag: it lets go, with nothing sent.
      if (lost(frame, el)) {
        moving = false
        return up(ev)
      }
      const dx = (ev.clientX - start.x) / dc.view.z / frame.s
      const dy = (ev.clientY - start.y) / dc.view.z / frame.s
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5 && !target && !moving) return
      moving = true
      if (positioned) {
        // Shift held keeps it straight across or straight down, as in Figma.
        const level = ev.shiftKey && Math.abs(dx) >= Math.abs(dy)
        const plumb = ev.shiftKey && !level
        el.style.left = `${Math.round(left0 + (plumb ? 0 : dx))}px`
        el.style.top = `${Math.round(top0 + (level ? 0 : dy))}px`
        draw()
        return
      }
      target = dropTarget(frame, dc.toWorld(ev.clientX, ev.clientY), el)
      dropLine = target?.line ?? null
      if (!dragGhost) el.style.opacity = '0.35'
      dragGhost = { x: from.x + ev.clientX - start.x, y: from.y + ev.clientY - start.y, w: from.w, h: from.h, name: nameOf(el).text }
      draw()
    }
    let moving = false
    const up = (ev) => {
      vp.removeEventListener('pointermove', move, true)
      removeEventListener('pointerup', up, true)
      dropLine = null
      if (dragGhost) { el.style.opacity = opacity0; if (!el.getAttribute('style')) el.removeAttribute('style') }
      dragGhost = null
      if (lost(frame, el)) return draw()
      if (!moving) return still ? still() : draw()
      if (positioned) return send({ op: 'style', cv: cvOf(el), props: { left: el.style.left, top: el.style.top } })
      draw()
      // Alt held as it is let go drops a copy there instead, as Figma's Alt+drag; the element stays where it was.
      if (target) send({ op: 'move', cv: cvOf(el), target: cvOf(target.el), where: target.where, ...(ev?.altKey ? { copy: true } : {}) })
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
    // Its own size, not the box drawn round it when it is turned; a drag is read along its turned sides.
    const r = sizeOf(el)
    // The handles drag the box as drawn; a content-box element's CSS size is that less its padding and border.
    const c = cs(el)
    const turn = ((/^(-?[\d.]+)deg$/.exec(c.rotate)?.[1] ?? 0) * Math.PI) / 180
    const n = (v) => parseFloat(v) || 0
    const inner = c.boxSizing === 'border-box' ? { w: 0, h: 0 } : {
      w: n(c.paddingLeft) + n(c.paddingRight) + n(c.borderLeftWidth) + n(c.borderRightWidth),
      h: n(c.paddingTop) + n(c.paddingBottom) + n(c.borderTopWidth) + n(c.borderBottomWidth),
    }
    const start = { x: e.clientX, y: e.clientY }
    let both = false
    const move = (ev) => {
      if (lost(f, el)) return up()
      const mx = (ev.clientX - start.x) / dc.view.z / f.s
      const my = (ev.clientY - start.y) / dc.view.z / f.s
      const dx = mx * Math.cos(turn) + my * Math.sin(turn)
      const dy = -mx * Math.sin(turn) + my * Math.cos(turn)
      const sx = hd.includes('w') ? -1 : hd.includes('e') ? 1 : 0
      const sy = hd.includes('n') ? -1 : hd.includes('s') ? 1 : 0
      let w = r.width + sx * dx
      let hh = r.height + sy * dy
      // Shift held keeps its proportions, as in Figma: the side pulled further sets the scale, and both sides follow.
      both = ev.shiftKey && r.width > 0 && r.height > 0
      if (both) {
        const k = !sy || (sx && Math.abs(w / r.width - 1) >= Math.abs(hh / r.height - 1)) ? w / r.width : hh / r.height
        w = r.width * k
        hh = r.height * k
      }
      if (sx || both) el.style.width = `${Math.max(0, Math.round(w - inner.w))}px`
      if (sy || both) el.style.height = `${Math.max(0, Math.round(hh - inner.h))}px`
      draw()
    }
    const up = () => {
      removeEventListener('pointermove', move, true)
      removeEventListener('pointerup', up, true)
      if (lost(f, el)) return draw()
      const props = {}
      if (both || /[ew]/.test(hd)) props.width = el.style.width
      if (both || /[ns]/.test(hd)) props.height = el.style.height
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
      // The page itself is never wrapped (Ctrl+G, or Shift+A on the whole screen): said here, before anything is sent.
      if (sel.els.some((x) => x.localName === 'body')) return hint('You can\'t wrap a whole screen. Select parts of it first.', 2500)
      const parent = primary().parentElement
      if (!sel.els.every((x) => x.parentElement === parent)) return hint('Only elements next to each other in the same parent can be grouped.', 3000)
      // As in Figma, grouping moves nothing: in a grid or flex row a plain box would take one cell or item for all
      // of them, so there the group has no box of its own and its parts keep their places.
      const laid = /flex|grid/.test(cs(parent).display)
      send({ op: 'wrap', cv: sel.els.map(cvOf), tag: 'div', style: style ?? (laid ? 'display: contents' : undefined), name })
    },
    ungroup: () => {
      if (!needEditable()) return
      if (sel.els.length !== 1 || !primary().children.length) return hint('Select one element that holds others to ungroup it', 2500)
      // The page itself is never taken apart: said here, before anything is sent.
      if (primary().localName === 'body') return hint('You can\'t ungroup a whole screen. Select a part of it first.', 2500)
      send({ op: 'unwrap', cv: cvOf(primary()) })
    },
    makeComponent: async () => {
      if (!needEditable()) return
      const el = primary()
      const own = el.getAttribute('data-name') || el.classList[0] || nameOf(el).kind
      const name = await dc.question('Name the component. Duplicate it to make copies: a style or a part added or removed in any copy is made in all of them; text typed stays each copy\'s own.', own.charAt(0).toUpperCase() + own.slice(1))
      if (!name?.trim()) return
      send({ op: 'attr', cv: cvOf(el), name: 'data-component', value: name.trim() })
    },
    /** A variant: this copy keeps the component's parts and takes a look of its own, shared with copies of the same variant. */
    variant: async () => {
      const c = componentOf(primary())
      if (!c || !needEditable()) return
      const name = await dc.question('Name this variant (empty for the main one). Styles changed on it reach only copies of the same variant; parts added or removed still reach every copy.', c.variant)
      if (name == null) return
      send({ op: 'attr', cv: cvOf(c.root), name: 'data-variant', value: name.trim() || null })
    },
    /** Switch this copy to another variant, as Figma's variant picker: each of its parts takes the style the same part has
        in a copy of that variant, and it takes that variant's name; its words stay its own. One edit. */
    switchVariant: (to) => {
      const c = componentOf(primary())
      if (!c || !needEditable()) return
      const model = c.copies.find((x) => x !== c.root && (x.getAttribute('data-variant')?.trim() ?? '') === to)
      if (!model) return
      const mine = [c.root, ...c.root.querySelectorAll('*')]
      const theirs = [model, ...model.querySelectorAll('*')]
      if (mine.length !== theirs.length) return hint('This copy\'s parts differ from that variant\'s: change it by hand', 2600)
      const styleOf = (el) => Object.fromEntries((el.getAttribute('style') ?? '').split(';').map((d) => d.split(':')).filter((d) => d.length > 1).map(([k, ...v]) => [k.trim().toLowerCase(), v.join(':').trim()]))
      const items = mine.map((el, i) => {
        const want = styleOf(theirs[i])
        const have = styleOf(el)
        const props = { ...Object.fromEntries(Object.keys(have).filter((k) => !(k in want)).map((k) => [k, ''])), ...Object.fromEntries(Object.entries(want).filter(([k, v]) => have[k] !== v)) }
        return { cv: cvOf(el), props, ...(i === 0 ? { attrs: { 'data-variant': to || null } } : {}) }
      }).filter((it, i) => it.cv != null && (i === 0 || Object.keys(it.props).length))
      send({ op: 'styles', items })
    },
    detach: () => {
      const c = componentOf(primary())
      if (!c || !needEditable()) return
      send({ op: 'attr', cv: cvOf(c.root), name: 'data-component', value: null })
    },
    wrapIn: (kind) => ops.group({ row: 'display: flex; flex-direction: row; gap: 8px', column: 'display: flex; flex-direction: column; gap: 8px', grid: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px' }[kind], { row: 'Row', column: 'Column', grid: 'Grid' }[kind]),
    // Figma's Copy as PNG (Ctrl+Shift+C) and Export: a picture of what is selected (the whole screen when it is the
    // screen), made by the server's browser at twice its size. The clipboard is asked at once, with the picture to
    // come, so the press still counts as the person's when it arrives.
    copyPng: () => {
      if (!sel) return
      const made = pngOf()
      try {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': made.then((b) => b ?? Promise.reject(new Error('no picture'))) })])
          .then(() => hint('Copied as PNG', 1200), () => made.then((b) => b && hint('This browser won\'t copy pictures. Use Export PNG in the … menu to save it instead.', 5000)))
      } catch {
        hint('This browser won\'t copy pictures. Use Export PNG in the … menu to save it instead.', 5000)
      }
    },
    // From Properties › Export, a scale and a format; its file named as Figma names one, with @2x and so on.
    exportPng: async ({ scale, type, suffix } = {}) => {
      if (!sel) return
      const base = (primary().localName === 'body' ? sel.frame.label : nameOf(primary()).text).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'picture'
      const name = `${base}${suffix && scale !== 1 ? `@${scale}x` : ''}.${type === 'jpeg' ? 'jpg' : 'png'}`
      const blob = await pngOf({ scale, type })
      if (!blob) return
      const a = h('a', { href: URL.createObjectURL(blob), download: name })
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      hint(`Saved ${name}`, 1600)
    },
    // The screen the selection is on as a PDF, one page as tall as it, its words kept as type.
    exportPdf: async () => {
      if (!sel) return
      if (!dc.serve || dc.local) return hint('To make a PDF, run the canvas from its folder with node scripts/canvas.mjs serve <folder>', 5000)
      const f = sel.frame
      const name = String(f.label || f.file).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'screen'
      hint('Making the PDF…', 8000)
      const res = await fetch(`/api/pdf?${new URLSearchParams({ f: f.file, w: String(Math.round(f.w)), h: String(Math.round(f.h)), ...(dc.schemeOf?.(f) !== 'auto' ? { scheme: dc.schemeOf(f) } : {}), ...(f.hash ? { hash: f.hash } : {}) })}`)
      if (!res.ok) return hint((await res.json().catch(() => ({}))).error || 'No PDF was made', 5000)
      const a = h('a', { href: URL.createObjectURL(await res.blob()), download: `${name}.pdf` })
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      hint(`Saved ${name}.pdf`, 1600)
    },
    // Figma's Shift+H and Shift+V: each selected element mirrored across (0) or up and down (1), by the CSS scale
    // property, apart from any transform; mirrored back, the property goes.
    flip: (i) => {
      if (!needEditable()) return
      const items = sel.els.filter(live).filter((x) => editable(x) && cvOf(x) != null).map((x) => {
        const k = cs(x)
        const n = k.scale === 'none' ? [1, 1] : k.scale.split(/\s+/).map(Number)
        const sc = [n[0], n[1] ?? n[0], ...n.slice(2)]
        sc[i] = -sc[i]
        return { cv: cvOf(x), props: { scale: sc.length === 2 && sc[0] === 1 && sc[1] === 1 ? '' : sc.join(' ') } }
      })
      if (items.length) send({ op: 'styles', items }, { then: reselect() })
    },
    // Figma's Shift+A: one element holding others becomes a flex box itself; anything else selected is wrapped in a new
    // one. A row when they sit side by side, else a column, with the space already between them as its gap, so the
    // look stays as it was.
    autoLayout: () => {
      if (!needEditable()) return
      // The gap is the space between them less their margins, which a flex box keeps (block flow lets them overlap).
      const arrange = (list) => {
        const on = list.map((x) => ({ x, r: boxOf(x), k: cs(x) })).filter((o) => o.r.width || o.r.height)
        if (on.length < 2) return { dir: 'column', gap: 0 }
        const across = [...on].sort((a, b) => a.r.left - b.r.left)
        const row = across.every((o, i) => i === 0 || o.r.left >= across[i - 1].r.right - 2)
        const line = row ? across : [...on].sort((a, b) => a.r.top - b.r.top)
        const m = (o, side) => parseFloat(o.k.getPropertyValue(`margin-${side}`)) || 0
        const gaps = line.slice(1).map((o, i) => (row ? o.r.left - line[i].r.right - m(line[i], 'right') - m(o, 'left') : o.r.top - line[i].r.bottom - m(line[i], 'bottom') - m(o, 'top'))).sort((a, b) => a - b)
        return { dir: row ? 'row' : 'column', gap: Math.max(0, Math.round(gaps[Math.floor(gaps.length / 2)])) }
      }
      // A column with an inline element in it (a button) keeps each at its own width, as a flex column would stretch it.
      const hug = (list, dir) => (dir === 'column' && list.some((x) => cs(x).display.startsWith('inline')) ? 'flex-start' : null)
      const el = primary()
      const kids = [...el.children].filter((x) => !SKIP.has(x.localName) && cs(x).display !== 'none')
      if (sel.els.length === 1 && el.localName !== 'body' && kids.length && !/flex|grid/.test(cs(el).display) && !ownText(el)) {
        const { dir, gap } = arrange(kids)
        // In a column, the blocks stretch across as they did and each inline element (a button) keeps its own width.
        const inline = dir === 'column' ? kids.filter((x) => cs(x).display.startsWith('inline') && editable(x) && cvOf(x) != null) : []
        return send({ op: 'styles', items: [{ cv: cvOf(el), props: { display: 'flex', 'flex-direction': dir, gap: `${gap}px` } }, ...inline.map((x) => ({ cv: cvOf(x), props: { 'align-self': 'flex-start' } }))] }, { then: reselect() })
      }
      const list = sel.els.filter(live)
      const { dir, gap } = arrange(list)
      ops.group(`display: flex; flex-direction: ${dir}; gap: ${gap}px${hug(list, dir) ? `; align-items: ${hug(list, dir)}` : ''}`)
    },
    copy: async () => {
      if (!sel) return
      // Every element selected, in the order the page has them; nested ones go with what holds them.
      const els = sel.els.filter(live).filter((e, _, all) => !all.some((o) => o !== e && o.contains(e)))
        .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      const parts = []
      for (const el of els) {
        let html = el.outerHTML.replace(/\s+data-cv="\d+"/g, '')
        if (dc.serve && cvOf(el) != null) {
          try {
            const res = await fetch(`/api/source?f=${encodeURIComponent(sel.frame.file)}&cv=${cvOf(el)}`)
            const body = await res.json()
            if (body.html) html = body.html
          } catch {}
        }
        parts.push(html)
      }
      // Another prototype may have none of this one's rules: what goes there carries on itself whatever of its look
      // that page would not give it. Each part's look is kept here, to compare against the page it lands in.
      const looks = els.map((el) => [el, ...el.querySelectorAll('*')].map((n) => Object.fromEntries(LOOK.map((p) => [p, cs(n).getPropertyValue(p)]))))
      clip = { html: parts.join('\n'), file: sel.frame.file, styled: els.map(standalone).join('\n'), looks }
      try { await navigator.clipboard.writeText(clip.html) } catch {}
      hint(els.length > 1 ? `Copied ${els.length}` : 'Copied', 900)
    },
    // Ctrl+X, as Figma's Cut: copied, then deleted in one step; Ctrl+V puts it after what is selected then.
    cut: async () => {
      if (!sel || !needEditable()) return
      if (sel.els.some((x) => x.localName === 'body')) return hint('The body stays', 1500)
      await ops.copy()
      ops.remove()
    },
    paste: () => {
      if (!clip) return hint('Nothing copied yet', 1200)
      if (!needEditable()) return
      const el = primary()
      const where = el.localName === 'body' ? 'inside' : 'after'
      const html = clip.file === sel.frame.file ? clip.html : lookedIn(el, where) ?? clip.styled
      send({ op: 'insert', cv: cvOf(el), where, html })
    },
    pasteReplace: () => {
      if (!clip) return hint('Nothing copied yet', 1200)
      if (!needEditable()) return
      const el = primary()
      if (sel.els.length !== 1 || el.localName === 'body') return hint('Select one part to replace it', 1600)
      const html = clip.file === sel.frame.file ? clip.html : lookedIn(el, 'after') ?? clip.styled
      send({ op: 'outer', cv: cvOf(el), html })
    },
    // Figma's Copy and Paste properties: the look alone (fill, border, radius, shadow, opacity, text), never the size,
    // place or content. A picture fill is left out: its URL as read is the served address, not the file's own path.
    copyProps: () => {
      if (!sel) return
      const c = cs(primary())
      look = Object.fromEntries(PROPS.map((p) => [p, propOf(c, p)]).filter(([p, v]) => !(p === 'background-image' && /url\(/.test(v))))
      hint('Copied its properties', 900)
    },
    pasteProps: () => {
      if (!look) return hint('No properties copied yet', 1200)
      if (!needEditable()) return
      const differ = (x, keys) => Object.fromEntries(keys.filter((p) => propOf(cs(x), p) !== look[p]).map((p) => [p, look[p]]))
      const keys = Object.keys(look)
      // Every copy of something selected: one change to the rule they share.
      if (everyCopy()) {
        const props = Object.fromEntries(keys.filter((p) => sel.els.some((x) => propOf(cs(x), p) !== look[p])).map((p) => [p, look[p]]))
        return Object.keys(props).length ? setStyle(props) : hint('It already looks like that', 1200)
      }
      // A box that holds text (a card) takes the fill, border and the rest itself, and every line of text in it takes
      // the type and text color, over any of its own, as a text color on a Figma group reaches every text in it.
      const items = []
      for (const x of sel.els) {
        const inner = isText(x) ? [] : [...x.querySelectorAll('*')].filter((t) => ownText(t) && editable(t) && cvOf(t) != null && !['script', 'style'].includes(t.localName))
        const own = differ(x, inner.length ? keys.filter((p) => !TEXT_PROPS.has(p)) : keys)
        if (Object.keys(own).length) items.push({ cv: cvOf(x), props: own })
        for (const t of inner) {
          const props = differ(t, keys.filter((p) => TEXT_PROPS.has(p)))
          if (Object.keys(props).length) items.push({ cv: cvOf(t), props })
        }
      }
      if (!items.length) return hint('It already looks like that', 1200)
      send({ op: 'styles', items }, { then: reselect() })
    },
    nudge: (dx, dy, alt) => {
      if (!needEditable()) return
      const el = primary()
      // The whole screen selected moves on the board, as Figma's arrows move a frame.
      if (el.localName === 'body') return dc.nudgeScreen(sel.frame, dx, dy)
      const placed = (x) => ['absolute', 'fixed', 'relative', 'sticky'].includes(cs(x).position)
      if (placed(el) && !alt) {
        // Each element selected moves from its own place, in one edit, as Figma nudges a selection: never all of them
        // to the first one's place.
        const items = sel.els.filter((x) => placed(x) && editable(x) && cvOf(x) != null).map((x) => ({
          cv: cvOf(x),
          props: { left: `${Math.round((parseFloat(cs(x).left) || 0) + dx)}px`, top: `${Math.round((parseFloat(cs(x).top) || 0) + dy)}px` },
        }))
        for (const it of items) Object.assign(sel.els.find((x) => cvOf(x) === it.cv).style, it.props)
        return send({ op: 'styles', items }, { then: reselect() })
      }
      if (!alt) return hint('This one sits in the page flow. Hold Alt with an arrow key to move it one place.', 2000)
      const prev = dx < 0 || dy < 0
      const sib = prev ? el.previousElementSibling : el.nextElementSibling
      if (!sib || cvOf(sib) == null) return
      send({ op: 'move', cv: cvOf(el), target: cvOf(sib), where: prev ? 'before' : 'after' })
    },
    // Figma's Bring forward, Send backward, Bring to front, Send to back. In a page, what comes later among its
    // siblings is drawn over the ones before it and comes after them in a row or column, so the order is moved there.
    restack: (forward, all) => {
      if (!needEditable()) return
      const el = primary()
      if (sel.els.length !== 1 || el.localName === 'body') return hint('Select one part to move it in front or behind', 1600)
      const sibs = [...el.parentElement.children].filter((c) => !SKIP.has(c.localName) && cvOf(c) != null)
      const i = sibs.indexOf(el)
      const to = all ? (forward ? sibs.at(-1) : sibs[0]) : sibs[i + (forward ? 1 : -1)]
      if (!to || to === el) return hint(forward ? 'It is already in front' : 'It is already at the back', 1200)
      if (!editable(to)) return hint('What it would pass is locked', 1600)
      send({ op: 'move', cv: cvOf(el), target: cvOf(to), where: forward ? 'after' : 'before' })
    },
  }
  let clip = null
  let look = null
  const PROPS = ['background-color', 'background-image', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius', 'box-shadow', 'opacity',
    'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-transform', 'text-decoration-line', 'text-align']
  const TEXT_PROPS = new Set(PROPS.slice(PROPS.indexOf('color')))
  /** A property as read for copying: a side with no border is `none`, whatever color it would have. */
  const propOf = (c, p) => {
    const v = c.getPropertyValue(p)
    return /^border-(top|right|bottom|left)$/.test(p) && /\bnone\b/.test(v) ? 'none' : v
  }
  /** The properties that make an element look as it does, carried onto it when it goes to another prototype. Sizes
      that come from its place (width, height) stay out, so it fits where it lands. */
  const LOOK = ['display', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'align-items', 'justify-content', 'gap', 'grid-template-columns', 'grid-template-rows',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'max-width', 'min-height',
    'background-color', 'background-image', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius', 'box-shadow', 'opacity', 'object-fit',
    'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'text-decoration-line', 'white-space', 'list-style-type']
  const INHERITS = new Set(['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'white-space', 'list-style-type'])
  let blankDoc = null
  /** The copied parts as they would land beside `el` (or inside it), each carrying on itself only the parts of its
   *  look that page would not give it: tried in place, the differences found before any is written, then taken out.
   *  A page that links the same stylesheet gives them their look by their classes, so nothing is written on them.
   *  Null when the copy cannot be matched part for part (a script made some of it), for the plain-page way. */
  function lookedIn(el, where) {
    if (!clip?.looks) return null
    const doc = el.ownerDocument
    const t = doc.createElement('template')
    t.innerHTML = clip.html
    const nodes = [...t.content.children]
    if (nodes.length !== clip.looks.length) return null
    const lists = nodes.map((n) => [n, ...n.querySelectorAll('*')])
    if (lists.some((l, i) => l.length !== clip.looks[i].length)) return null
    if (where === 'inside') el.append(...nodes)
    else el.after(...nodes)
    try {
      const wants = lists.flatMap((l, i) => l.map((n, j) => {
        const c = cs(n)
        return [n, LOOK.filter((p) => c.getPropertyValue(p) !== clip.looks[i][j][p]).map((p) => [p, clip.looks[i][j][p]])]
      }))
      for (const [n, props] of wants) for (const [p, v] of props) n.style.setProperty(p, v)
      return nodes.map((n) => n.outerHTML).join('\n')
    } finally {
      for (const n of nodes) n.remove()
    }
  }
  /** A tag's look with no stylesheet but the browser's own, from a blank page kept for it. */
  function defaultLook(tag) {
    if (!blankDoc) {
      const f = h('iframe', { 'aria-hidden': 'true', tabindex: '-1', style: 'position:fixed;left:-9999px;top:0;width:800px;height:200px;border:0;visibility:hidden' })
      document.body.append(f)
      blankDoc = f.contentDocument
      blankDoc.open()
      blankDoc.write('<!doctype html><html><body></body></html>')
      blankDoc.close()
    }
    const el = blankDoc.createElement(tag)
    blankDoc.body.append(el)
    const c = blankDoc.defaultView.getComputedStyle(el)
    const out = Object.fromEntries(LOOK.map((p) => [p, c.getPropertyValue(p)]))
    out['@body'] = Object.fromEntries([...INHERITS].map((p) => [p, blankDoc.defaultView.getComputedStyle(blankDoc.body).getPropertyValue(p)]))
    el.remove()
    return out
  }
  /** The element's markup with each part's look written on it wherever it differs from the browser's plain one:
      inherited text properties only where they differ from the part that holds it (on the outermost, from a plain body). */
  function standalone(root) {
    const clone = root.cloneNode(true)
    const src = [root, ...root.querySelectorAll('*')]
    const dst = [clone, ...clone.querySelectorAll('*')]
    src.forEach((s, i) => {
      const d = dst[i]
      if (['script', 'style', 'template'].includes(s.localName)) return
      const c = cs(s)
      const plain = defaultLook(s.localName)
      const up = i ? cs(s.parentElement) : null
      for (const p of LOOK) {
        const v = c.getPropertyValue(p)
        if (INHERITS.has(p)) {
          // A heading or a <b> sets its own size or weight; anything else takes it from what holds it.
          const tagSets = plain[p] !== plain['@body'][p]
          if (!tagSets && v === (up ? up.getPropertyValue(p) : plain['@body'][p])) continue
          if (tagSets && v === plain[p] && !up) continue
        } else if (v === plain[p]) continue
        if (!d.style.getPropertyValue(p)) d.style.setProperty(p, v)
      }
      for (const a of ['contenteditable', 'spellcheck', 'data-dc-state', 'data-cv']) d.removeAttribute(a)
    })
    return clone.outerHTML
  }

  // ── keys ──
  hooks.onKey = (e) => {
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (mod && k === 'z') {
      e.preventDefault()
      undoLast(e.shiftKey)
      return true
    }
    if (mod && k === 'y') {
      e.preventDefault()
      undoLast(true)
      return true
    }
    const el = primary()
    if (!sel || !el) return false
    if (mod && e.altKey && k === 'k') ops.makeComponent()
    // By the key's place, so a layout where Ctrl+Alt types a character still reaches them.
    else if (mod && e.altKey && e.code === 'KeyC') ops.copyProps()
    else if (mod && e.altKey && e.code === 'KeyV') ops.pasteProps()
    // Figma's Paste to replace (Ctrl+Shift+R): what was copied takes the selected part's place. With nothing copied the
    // key is left to the browser (a reload).
    else if (mod && e.shiftKey && !e.altKey && e.code === 'KeyR' && clip) ops.pasteReplace()
    // Figma's Rename (Ctrl+R): the selected element's row in Layers takes its name, as a double-click on it does.
    else if (mod && !e.shiftKey && !e.altKey && k === 'r') {
      if (sel.els.length > 1) dc.renameLayers?.()
      else if (el.localName === 'body' || cvOf(el) == null) hint('Select a part to rename it', 1600)
      else dc.renameLayer?.()
    }
    // Figma's text alignment keys: Ctrl+Alt+L left, T center, R right, J justified, as the toolbar's Align does.
    else if (mod && e.altKey && !e.shiftKey && ['KeyL', 'KeyT', 'KeyR', 'KeyJ'].includes(e.code)) {
      const a = { KeyL: 'left', KeyT: 'center', KeyR: 'right', KeyJ: 'justify' }[e.code]
      setStyle({ 'text-align': a })
      hint(`Aligned ${a === 'justify' ? 'to both edges' : a}`, 900)
    }
    // Figma's text keys, > up and < down, each element from its own value: Ctrl+Shift the size, Ctrl+Alt the weight,
    // Alt the letter spacing, Alt+Shift the line height.
    else if ((e.code === 'Period' || e.code === 'Comma') && (mod || e.altKey)) {
      const d = e.code === 'Period' ? 1 : -1
      if (mod && e.shiftKey && !e.altKey) textStep('font-size', d)
      else if (mod && e.altKey && !e.shiftKey) textStep('font-weight', d)
      else if (!mod && e.altKey && e.shiftKey) textStep('line-height', d)
      else if (!mod && e.altKey) textStep('letter-spacing', d)
    }
    // Figma's list keys: Ctrl+Shift+8 bullets, Ctrl+Shift+7 numbers; the same key on that kind of list turns it back
    // into a paragraph.
    else if (mod && e.shiftKey && !e.altKey && (e.code === 'Digit8' || e.code === 'Digit7')) listAs(e.code === 'Digit8' ? 'ul' : 'ol')
    // Figma's Strikethrough (Ctrl+Shift+X), on or off, keeping an underline that is there.
    else if (mod && e.shiftKey && !e.altKey && e.code === 'KeyX') strike()
    // Figma's layer order: Ctrl+] forward and Ctrl+[ backward one place, with Shift to the front or back.
    else if (mod && !e.altKey && (e.code === 'BracketRight' || e.code === 'BracketLeft')) ops.restack(e.code === 'BracketRight', e.shiftKey)
    // Figma's Show/Hide: hides what is selected, or shows it when all of it is hidden.
    else if (mod && e.shiftKey && k === 'h') setHidden(sel.frame, sel.els, sel.els.some((x) => cs(x).display !== 'none'))
    // Figma's Lock (Ctrl+Shift+L): the owner locks the selected part, or unlocks it, as the toolbar's padlock does.
    else if (mod && e.shiftKey && k === 'l') {
      if (!dc.owner) hint('Only the owner can lock things.', 1600)
      else if (sel.els.length !== 1 || cvOf(el) == null || fileLocked(sel.frame.file) || (!el.hasAttribute('data-locked') && el.parentElement?.closest('[data-locked]'))) hint('Select one part that isn\'t inside a locked one.', 2000)
      else send({ op: 'attr', cv: cvOf(el), name: 'data-locked', value: el.hasAttribute('data-locked') ? null : 'true' })
    }
    // The whole screen selected (its label clicked): Ctrl+D copies the screen, as Figma duplicates a frame.
    else if (mod && k === 'd') el.localName === 'body' ? dc.duplicateScreens([sel.frame]) : ops.duplicate()
    else if (mod && k === 'g') e.shiftKey ? ops.ungroup() : ops.group()
    else if (mod && e.shiftKey && k === 'c') ops.copyPng()
    else if (mod && k === 'c') ops.copy()
    else if (mod && k === 'x') ops.cut()
    // With nothing copied here, Ctrl+V is left to the page: a picture on the clipboard goes into the prototype.
    else if (mod && k === 'v' && clip) ops.paste()
    // Everything alongside the selection, as Figma's Ctrl+A: the selected element's siblings.
    // Figma's Select matching layers: every copy like it on the screen (what Alt+click picks).
    else if (mod && e.altKey && !e.shiftKey && e.code === 'KeyA') {
      const all = copiesOf(el)
      if (all.length < 2) hint('Nothing else on this screen is like it', 1600)
      else select(sel.frame, [el, ...all.filter((x) => x !== el)])
    // Figma's Select inverse (Ctrl+Shift+A): what sits alongside the selection and is not in it.
    } else if (mod && e.shiftKey && !e.altKey && e.code === 'KeyA' && el.localName !== 'body') {
      const rest = [...(el.parentElement?.children ?? [])].filter((c) => !SKIP.has(c.localName) && !sel.els.includes(c))
      if (!rest.length) hint('Nothing else sits alongside it', 1600)
      else select(sel.frame, rest)
    } else if (mod && k === 'a' && !e.shiftKey && !e.altKey) {
      const all = [...(el.parentElement?.children ?? [])].filter((c) => !SKIP.has(c.localName))
      if (el.localName === 'body' || all.length < 2) return false
      select(sel.frame, all)
    } else if (mod) return false
    else if (e.key === 'Delete' || e.key === 'Backspace') ops.remove()
    else if (e.shiftKey && !e.altKey && k === 'a') ops.autoLayout()
    else if (e.shiftKey && !e.altKey && (k === 'h' || k === 'v') && el.localName !== 'body') ops.flip(k === 'h' ? 0 : 1)
    else if (e.key === 'Escape') {
      const up = el.parentElement
      if (!up || el.localName === 'body' || up.localName === 'html') select(null, [])
      else select(sel.frame, [up])
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        if (el.parentElement && el.localName !== 'body') select(sel.frame, [el.parentElement])
      } else if (isText(el) && editable(el)) startEditing(sel.frame, el)
      else {
        // Every child, as Figma's Enter selects a group's children.
        const kids = [...el.children].filter((c) => !SKIP.has(c.localName))
        if (kids.length) select(sel.frame, kids)
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
  // A mesh fill: color points over the element's fill, each a radial gradient from its color at its place fading to
  // nothing at its spread, so the points blend into one another as a freeform gradient mesh does. Plain CSS, kept in
  // the prototype's own file: `radial-gradient(at x% y%, color 0px, transparent spread%)`, one layer a point.
  // meshOf reads a computed background-image as points, or null where it is anything else.
  const meshOf = (image) => {
    if (!image || !image.startsWith('radial-gradient(at ')) return null
    const layers = []
    let depth = 0
    let at = 0
    for (let i = 0; i < image.length; i++) {
      const ch = image[i]
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (ch === ',' && depth === 0) { layers.push(image.slice(at, i).trim()); at = i + 1 }
    }
    layers.push(image.slice(at).trim())
    const points = []
    for (const l of layers) {
      const m = /^radial-gradient\(at (-?[\d.]+)% (-?[\d.]+)%, (rgba?\([^)]*\)) 0px, (?:transparent|rgba\(0, 0, 0, 0\)) ([\d.]+)%\)$/.exec(l)
      if (!m) return null
      points.push({ x: Number(m[1]), y: Number(m[2]), color: m[3], spread: Number(m[4]) })
    }
    return points.length ? points : null
  }
  const round1 = (n) => Math.round(n * 10) / 10
  const meshCss = (points) => points.map((p) => `radial-gradient(at ${round1(p.x)}% ${round1(p.y)}%, ${p.color} 0px, transparent ${round1(p.spread)}%)`).join(', ')
  // A grid mesh, as Illustrator's gradient mesh: a lattice of points, each a color, whose colors and places blend
  // along smooth curves (Catmull-Rom through the lattice, for color and place alike), so moving a point bends the
  // color around it. The web draws no mesh of its own: the canvas draws it as a small picture, smooth enough to be
  // stretched over the element, kept in the element's own CSS; the lattice is kept in its data-mesh attribute
  // ({ rows, cols, pts: [[x, y, color], …] }, x and y from 0 to 1) to edit again.
  const gridOf = (el) => {
    try {
      const g = JSON.parse(el?.getAttribute('data-mesh') ?? 'null')
      return g && g.rows >= 2 && g.cols >= 2 && Array.isArray(g.pts) && g.pts.length === g.rows * g.cols ? g : null
    } catch { return null }
  }
  const rgbOf = (c) => {
    const ctx = rgbOf.ctx ?? (rgbOf.ctx = document.createElement('canvas').getContext('2d'))
    ctx.fillStyle = '#000'
    ctx.fillStyle = c
    const v = ctx.fillStyle
    if (v.startsWith('#')) return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16))
    return (/(\d+),\s*(\d+),\s*(\d+)/.exec(v) ?? [0, 0, 0, 0]).slice(1, 4).map(Number)
  }
  const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
  /** The lattice's surface at (row, col) given as fractions: [x, y, r, g, b]. */
  function gridAt(g, rgb, row, col) {
    const val = (i, j) => { const k = Math.min(g.rows - 1, Math.max(0, i)) * g.cols + Math.min(g.cols - 1, Math.max(0, j)); return [g.pts[k][0], g.pts[k][1], ...rgb[k]] }
    const i = Math.min(g.rows - 2, Math.floor(row))
    const j = Math.min(g.cols - 2, Math.floor(col))
    const v = row - i
    const u = col - j
    const across = (ii) => { const q = [-1, 0, 1, 2].map((d) => val(ii, j + d)); return q[0].map((_, n) => cr(q[0][n], q[1][n], q[2][n], q[3][n], u)) }
    const rowsAt = [-1, 0, 1, 2].map((d) => across(i + d))
    return rowsAt[0].map((_, n) => cr(rowsAt[0][n], rowsAt[1][n], rowsAt[2][n], rowsAt[3][n], v))
  }
  /** The lattice drawn w × h, as a WebP data URL. */
  function drawGrid(g, w, h) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    const rgb = g.pts.map((p) => rgbOf(p[2]))
    const S = 18
    const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)))
    for (let pi = 0; pi < g.rows - 1; pi++) for (let pj = 0; pj < g.cols - 1; pj++) {
      const V = []
      for (let a = 0; a <= S; a++) { V.push([]); for (let b = 0; b <= S; b++) V[a].push(gridAt(g, rgb, pi + a / S, pj + b / S)) }
      for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) {
        const q = [V[a][b], V[a][b + 1], V[a + 1][b + 1], V[a + 1][b]]
        const col = `rgb(${clamp((q[0][2] + q[1][2] + q[2][2] + q[3][2]) / 4)}, ${clamp((q[0][3] + q[1][3] + q[2][3] + q[3][3]) / 4)}, ${clamp((q[0][4] + q[1][4] + q[2][4] + q[3][4]) / 4)})`
        ctx.beginPath()
        q.forEach((p, n) => (n ? ctx.lineTo(p[0] * w, p[1] * h) : ctx.moveTo(p[0] * w, p[1] * h)))
        ctx.closePath()
        ctx.fillStyle = ctx.strokeStyle = col
        ctx.lineWidth = 1
        ctx.fill()
        ctx.stroke()
      }
    }
    return c.toDataURL('image/webp', 0.92)
  }
  /** The picture's size: 160 across, its height as the element's, so it stretches evenly. */
  const gridSize = (el, across = 160) => { const r = boxOf(el); return [across, Math.max(8, Math.min(across * 3, Math.round((across * r.height) / Math.max(1, r.width))))] }
  const gridProps = (el, g, across) => ({ 'background-image': `url("${drawGrid(g, ...gridSize(el, across))}")`, 'background-size': '100% 100%', 'background-repeat': 'no-repeat' })
  const gridJson = (g) => JSON.stringify({ rows: g.rows, cols: g.cols, pts: g.pts.map(([x, y, c]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, c]) })
  /** A lattice written: its picture and itself in one edit, one undo step; null takes the mesh off. */
  function writeGrid(el, g) {
    send({ op: 'styles', items: [{ cv: cvOf(el), props: g ? gridProps(el, g) : { 'background-image': '', 'background-size': '', 'background-repeat': '' }, attrs: { 'data-mesh': g ? gridJson(g) : '' } }] })
  }
  /** The lattice resampled to rows × cols from the surface it draws now, so its look holds. */
  function regrid(g, rows, cols) {
    const rgb = g.pts.map((p) => rgbOf(p[2]))
    const pts = []
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const v = gridAt(g, rgb, (i / (rows - 1)) * (g.rows - 1), (j / (cols - 1)) * (g.cols - 1))
      const hex = '#' + v.slice(2).map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')
      pts.push([Math.max(0, Math.min(1, v[0])), Math.max(0, Math.min(1, v[1])), hex])
    }
    return { rows, cols, pts }
  }
  /** A lattice point dragged: those on an edge keep to it, so the mesh still covers the element. */
  function startGridDrag(e, el, k) {
    e.stopPropagation()
    e.preventDefault()
    const g = gridOf(el)
    if (!g) return
    const f = sel.frame
    const r = boxOf(el)
    const i = Math.floor(k / g.cols)
    const j = k % g.cols
    const start = { x: e.clientX, y: e.clientY, px: g.pts[k][0], py: g.pts[k][1] }
    let moved = false
    let frame = 0
    const move = (ev) => {
      const dx = (ev.clientX - start.x) / dc.view.z / f.s
      const dy = (ev.clientY - start.y) / dc.view.z / f.s
      if (Math.abs(dx) + Math.abs(dy) > 1) moved = true
      if (j !== 0 && j !== g.cols - 1) g.pts[k][0] = Math.min(1, Math.max(0, start.px + dx / r.width))
      if (i !== 0 && i !== g.rows - 1) g.pts[k][1] = Math.min(1, Math.max(0, start.py + dy / r.height))
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        for (const [p, v] of Object.entries(gridProps(el, g, 64))) el.style.setProperty(p, v)
        el.setAttribute('data-mesh', gridJson(g))
        draw()
      })
    }
    const up = () => {
      removeEventListener('pointermove', move, true)
      removeEventListener('pointerup', up, true)
      cancelAnimationFrame(frame)
      if (moved) return writeGrid(el, g)
      // A click on a point without moving it: its color, picked there.
      const pickr = h('input', { type: 'color', value: rgbHex(g.pts[k][2]), style: 'position:fixed;left:-99px;top:0;opacity:0' })
      document.body.append(pickr)
      pickr.addEventListener('change', () => { g.pts[k][2] = pickr.value; pickr.remove(); writeGrid(el, g) })
      pickr.addEventListener('blur', () => setTimeout(() => pickr.remove(), 500))
      try { pickr.showPicker() } catch { pickr.click() }
    }
    addEventListener('pointermove', move, true)
    addEventListener('pointerup', up, true)
  }
  /** A mesh point dragged on the element: seen as it moves, written once on letting go, one undo step. */
  function startMeshDrag(e, el, i) {
    e.stopPropagation()
    e.preventDefault()
    const points = meshOf(cs(el).backgroundImage)
    if (!points) return
    const f = sel.frame
    const r = boxOf(el)
    const start = { x: e.clientX, y: e.clientY, px: points[i].x, py: points[i].y }
    let moved = false
    const move = (ev) => {
      const dx = (ev.clientX - start.x) / dc.view.z / f.s
      const dy = (ev.clientY - start.y) / dc.view.z / f.s
      if (Math.abs(dx) + Math.abs(dy) > 1) moved = true
      points[i].x = Math.min(100, Math.max(0, start.px + (dx / r.width) * 100))
      points[i].y = Math.min(100, Math.max(0, start.py + (dy / r.height) * 100))
      el.style.setProperty('background-image', meshCss(points))
      draw()
    }
    const up = () => {
      removeEventListener('pointermove', move, true)
      removeEventListener('pointerup', up, true)
      if (moved) send({ op: 'style', cv: cvOf(el), props: { 'background-image': meshCss(points) } })
    }
    addEventListener('pointermove', move, true)
    addEventListener('pointerup', up, true)
  }
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
  /** Bold, italic or underline on or off: when the element's CSS alone already gives what is wanted, its own value is removed; otherwise the value is written. */
  function toggleStyle(prop, on, onValue, offValue, isOn, read = prop) {
    // Each element selected on its own: a headline bold by its CSS needs nothing to be bold, the paragraph beside it
    // needs a weight written.
    const each = sel.els.filter(live).map((x) => {
      const own = x.style.getPropertyValue(prop)
      x.style.removeProperty(prop)
      const byCss = isOn(cs(x).getPropertyValue(read))
      if (own) x.style.setProperty(prop, own)
      return { x, value: byCss === on ? '' : on ? onValue : offValue }
    })
    if (new Set(each.map((e) => e.value)).size === 1 || everyCopy() || dc.stateRuleFor?.(primary())) return setStyle({ [prop]: each[0].value })
    send({ op: 'styles', items: each.filter((e) => editable(e.x) && cvOf(e.x) != null).map((e) => ({ cv: cvOf(e.x), props: { [prop]: e.value } })) }, { then: reselect() })
  }
  /** A text setting stepped up or down, each element selected from its own value, as Figma's keys step them: size by
   *  1px, weight by 100 (100 to 900), line height by 1px, letter spacing by 0.5px. */
  const TEXT_STEP = {
    'font-size': { by: 1, read: (k) => parseFloat(k.fontSize), out: (v) => `${Math.max(1, Math.round(v))}px`, say: 'Size' },
    'font-weight': { by: 100, read: (k) => Number(k.fontWeight) || 400, out: (v) => String(Math.min(900, Math.max(100, Math.round(v / 100) * 100))), say: 'Weight' },
    'line-height': { by: 1, read: (k) => (k.lineHeight === 'normal' ? Math.round(parseFloat(k.fontSize) * 1.2) : parseFloat(k.lineHeight)), out: (v) => `${Math.max(1, Math.round(v))}px`, say: 'Line height' },
    'letter-spacing': { by: 0.5, read: (k) => (k.letterSpacing === 'normal' ? 0 : parseFloat(k.letterSpacing)), out: (v) => `${Math.round(v * 2) / 2}px`, say: 'Letter spacing' },
  }
  function textStep(prop, d) {
    if (!sel) return
    if (!sel.els.every(editable)) return hint(notEditable(primary()), 3000)
    const t = TEXT_STEP[prop]
    const each = sel.els.filter(live).map((x) => ({ x, value: t.out(t.read(cs(x)) + d * t.by) }))
    if (!each.length) return
    if (new Set(each.map((e) => e.value)).size === 1 || everyCopy() || dc.stateRuleFor?.(primary())) setStyle({ [prop]: each[0].value })
    else {
      for (const e of each) e.x.style.setProperty(prop, e.value)
      draw()
      send({ op: 'styles', items: each.filter((e) => cvOf(e.x) != null).map((e) => ({ cv: cvOf(e.x), props: { [prop]: e.value } })) }, { then: reselect() })
    }
    hint(each.length === 1 ? `${t.say} ${each[0].value}` : `${t.say} ${d > 0 ? 'up' : 'down'}, each from its own`, 900)
  }
  function colorButton(title, prop, value, onPick, targets = () => sel?.els.filter(live) ?? []) {
    const input = h('input', { type: 'color', value: rgbHex(value), 'aria-label': title })
    // A see-through color keeps its see-through when another is picked, as Properties' colors do.
    const alpha = value && value !== 'Mixed' && value !== 'rgba(0, 0, 0, 0)' ? /rgba\([^)]*,\s*([\d.]+)\)/.exec(value)?.[1] : null
    const keep = (hex) => {
      const m = alpha && Number(alpha) < 1 ? /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) : null
      return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})` : hex
    }
    // Seen at once while the picker is open; written once, when it closes.
    input.addEventListener('input', () => {
      if (editing) return
      for (const el of targets()) el.style.setProperty(prop, keep(input.value))
      input.previousElementSibling.style.background = keep(input.value)
    })
    input.addEventListener('change', () => onPick(keep(input.value)))
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
    // Inside a component's copy: its name and how many copies a change here reaches; a click selects the copy whole.
    const comp = sel.els.length === 1 ? componentOf(el) : null
    // Served by node, a change also reaches the component's copies on the other screens that have it.
    const mark = comp ? `data-component="${comp.name.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"` : ''
    const screens = comp && dc.serve && !dc.local ? 1 + Object.entries(dc.data.files).filter(([f, html]) => f !== sel.frame.file && html.includes(mark)).length : 1
    const onScreens = screens > 1 ? `, on this screen and ${screens - 1} other${screens === 2 ? '' : 's'}` : ''
    if (comp) parts.push(h('button', { type: 'button', class: 'fbtn wide comp', title: `A copy of the component ${comp.name}${comp.variant ? `, variant ${comp.variant}` : ''}: a style changed here reaches the ${comp.alike.length} ${comp.variant ? `${comp.variant} ` : ''}cop${comp.alike.length === 1 ? 'y' : 'ies'}, a part added or removed all ${comp.copies.length}${onScreens}; text typed stays this copy's own. Click to select the copy whole.`, onclick: () => select(sel.frame, [comp.root]) }, h('span', { class: 'comp-mark', 'aria-hidden': 'true' }, '◇'), `${comp.name}${comp.variant ? ` / ${comp.variant}` : ''} · ${comp.alike.length}${screens > 1 ? ` · ${screens} screens` : ''}`))
    if (text && canEdit) {
      const cls = el.classList[0]
      const label = cls ? `.${cls}` : `${shared('font-family').split(',')[0].replace(/["']/g, '')} · ${shared('font-size')}`
      parts.push(h('button', { type: 'button', class: 'fbtn wide', title: 'Text style', onclick: (e) => textStyles(e.currentTarget) }, label, h('span', { class: 'caret' }, '▾')))
      parts.push(colorButton('Text color', 'color', shared('color'), (v) => (styleRun('color', v) || setStyle({ color: v }))))
      const bold = Number(shared('font-weight')) >= 600
      parts.push(h('button', { type: 'button', class: 'fbtn', title: 'Bold', 'aria-pressed': String(bold), onclick: () => (editing ? editing.frame.doc.execCommand('bold') : toggleStyle('font-weight', !bold, '700', '400', (v) => Number(v) >= 600)) }, h('b', {}, 'B')))
      const italic = shared('font-style') === 'italic'
      parts.push(h('button', { type: 'button', class: 'fbtn', title: 'Italic', 'aria-pressed': String(italic), onclick: () => (editing ? editing.frame.doc.execCommand('italic') : toggleStyle('font-style', !italic, 'italic', 'normal', (v) => v === 'italic')) }, h('i', {}, 'I')))
      const under = shared('text-decoration-line').includes('underline')
      parts.push(h('button', { type: 'button', class: 'fbtn', title: 'Underline', 'aria-pressed': String(under), onclick: () => (editing ? editing.frame.doc.execCommand('underline') : toggleStyle('text-decoration', !under, 'underline', 'none', (v) => v.includes('underline'), 'text-decoration-line')) }, h('u', {}, 'U')))
      parts.push(h('button', { type: 'button', class: 'fbtn', title: 'Link', onclick: link }, dc.icon('link')))
      parts.push(h('button', { type: 'button', class: 'fbtn', title: 'List', onclick: list }, '☰'))
      const ta = shared('text-align')
      parts.push(h('button', { type: 'button', class: 'fbtn', title: `Align: ${ta}`, onclick: (e) => dc.openMenu(e.currentTarget, ['left', 'center', 'right', 'justify'].map((a) => ({ label: a[0].toUpperCase() + a.slice(1), tick: ta === a || (a === 'left' && ta === 'start'), run: () => setStyle({ 'text-align': a }) }))) }, alignGlyph(['center', 'right', 'justify'].includes(ta) ? ta : 'left')))
    }
    // A group or a card is not text, but holds lines of it: a text color for all of them.
    if (!text && canEdit) {
      const texts = textsIn()
      if (texts.length) {
        const seen = new Set(texts.map((x) => cs(x).color))
        parts.push(colorButton('Text color', 'color', seen.size === 1 ? [...seen][0] : 'Mixed', colorTexts, textsIn))
        // Bold and italic for every line in it: on when every line already is.
        const bold = texts.every((x) => Number(cs(x).fontWeight) >= 600)
        parts.push(h('button', { type: 'button', class: 'fbtn', title: 'Bold, every line in it', 'aria-pressed': String(bold), onclick: () => styleTexts({ 'font-weight': bold ? '400' : '700' }) }, h('b', {}, 'B')))
        const italic = texts.every((x) => cs(x).fontStyle === 'italic')
        parts.push(h('button', { type: 'button', class: 'fbtn', title: 'Italic, every line in it', 'aria-pressed': String(italic), onclick: () => styleTexts({ 'font-style': italic ? 'normal' : 'italic' }) }, h('i', {}, 'I')))
      }
    }
    // A list selected whole is not text, but the List button is how it becomes numbers or a paragraph again.
    if (!text && canEdit && ['ul', 'ol'].includes(el.localName)) parts.push(h('button', { type: 'button', class: 'fbtn', title: 'List', 'aria-label': el.localName === 'ul' ? 'List: make it numbered' : 'List: make it a paragraph', onclick: list }, el.localName === 'ul' ? '1.' : '¶'))
    if (boxy && canEdit) {
      if (text) parts.push(h('span', { class: 'sep' }))
      const d = shared('display')
      // A group with no box of its own (display: contents) draws no fill, corners or padding: only its layout is offered.
      const flat = d === 'contents'
      if (!flat) {
        // Over a gradient a fill color would change nothing seen: the chip shows the gradient, and a color picked
        // takes its place.
        const image = shared('background-image')
        const gridded = sel.els.filter(live).some((x) => gridOf(x))
        const graded = gridded || (/gradient\(/.test(image ?? '') && !meshOf(image))
        const fill = colorButton('Fill', 'background-color', shared('background-color'), (v) => (gridded
          ? send({ op: 'styles', items: sel.els.filter(live).filter((x) => editable(x) && cvOf(x) != null).map((x) => ({ cv: cvOf(x), props: { 'background-color': v, 'background-image': '', 'background-size': '', 'background-repeat': '' }, attrs: { 'data-mesh': '' } })) })
          : setStyle(graded ? { 'background-color': v, 'background-image': 'none' } : { 'background-color': v })))
        if (graded) {
          fill.title = `Fill: a color picked replaces the ${gridded ? 'mesh' : 'gradient'}`
          fill.querySelector('.chip').style.background = image
          fill.querySelector('input').addEventListener('input', () => { if (!editing) for (const x of sel?.els.filter(live) ?? []) x.style.setProperty('background-image', 'none') })
        }
        parts.push(fill)
      }
      parts.push(h('button', { type: 'button', class: 'fbtn', title: `Layout: ${d}`, onclick: (e) => dc.openMenu(e.currentTarget, [
        ...(flat ? [{ label: 'Group: no box, its parts keep their places', tick: true, run: () => {} }] : []),
        { label: 'Block', tick: d === 'block', run: () => setStyle({ display: 'block' }) },
        { label: 'Flex row', tick: d.includes('flex') && !shared('flex-direction').startsWith('column'), run: () => setStyle({ display: d.startsWith('inline') ? 'inline-flex' : 'flex', 'flex-direction': 'row' }) },
        { label: 'Flex column', tick: d.includes('flex') && shared('flex-direction').startsWith('column'), run: () => setStyle({ display: d.startsWith('inline') ? 'inline-flex' : 'flex', 'flex-direction': 'column' }) },
        { label: 'Grid', tick: d.includes('grid'), run: () => setStyle({ display: 'grid' }) },
        '-',
        { label: 'Wrap in flex row', run: () => ops.wrapIn('row') },
        { label: 'Wrap in flex column', run: () => ops.wrapIn('column') },
        { label: 'Wrap in grid', run: () => ops.wrapIn('grid') },
      ]) }, '▦'))
      if (!flat) {
        parts.push(numberButton('Corner radius', '◜', 'border-radius', shared('border-top-left-radius')))
        parts.push(numberButton('Padding', '⊡', 'padding', shared('padding-top')))
      }
    }
    if (canEdit) parts.push(h('span', { class: 'sep' }))
    // The owner locks a part of the prototype: it and everything in it stay as they are.
    if (dc.owner && sel.els.length === 1 && cvOf(el) != null && !fileLocked(sel.frame.file)) {
      const own = el.hasAttribute('data-locked')
      const inLocked = !own && !!el.parentElement?.closest('[data-locked]')
      if (!inLocked) parts.push(h('button', { type: 'button', class: `fbtn${own ? ' on' : ''}`, title: own ? 'Locked: click to unlock' : 'Lock this part: nobody changes, moves or deletes it', 'aria-pressed': String(own), onclick: () => send({ op: 'attr', cv: cvOf(el), name: 'data-locked', value: own ? null : 'true' }) }, dc.icon(own ? 'lock' : 'unlock')))
    } else if (lockedEl(el)) parts.push(h('span', { class: 'fbtn', title: notEditable(el) }, dc.icon('lock')))
    if (dc.commenting) parts.push(h('button', { type: 'button', class: 'fbtn', title: 'Comment on it', onclick: () => { const t = hooks.selectionTarget(); if (t) dc.commentOn(t) } }, dc.icon('comment')))
    // Editing off but one click from on (from disk, in Chrome or Edge): the way in is on the bar itself.
    if (!dc.serve && dc.startLocal) parts.push(h('button', { type: 'button', class: 'fbtn cta', title: 'Edit and comment here: pick the folder this canvas is in, once', onclick: () => dc.startLocal() }, 'Edit'))
    parts.push(h('button', { type: 'button', class: 'fbtn', title: 'More', onclick: (e) => more(e.currentTarget) }, '…'))
    floatBar.append(...parts)
    floatBar.classList.add('open')
    placeFloat()
  }
  const alignGlyph = (a) => h('span', { class: 'align-glyph', 'data-a': a }, h('i'), h('i'), h('i'))
  /** A number on the toolbar, shown beside its glyph; a click opens a field under it, as Figma's
      fields: typing or ↑ ↓ (Shift for 10) shows the change at once, Enter or leaving it writes it,
      Escape puts it back. Any CSS value may be typed; a bare number is pixels. */
  function numberButton(title, glyph, prop, value) {
    const shown = value === 'Mixed' ? 'Mixed' : String(Math.round(parseFloat(value) || 0))
    const btn = h('button', { type: 'button', class: 'fbtn num', title: `${title}: ${value}`, 'aria-label': `${title}: ${value}`, onclick: () => openField() }, h('span', { 'aria-hidden': 'true' }, glyph), h('span', { class: 'num-v' }, shown))
    function openField() {
      document.getElementById('num-field')?.remove()
      const els = sel?.els.filter(live) ?? []
      if (!els.length) return
      const before = els.map((el) => el.style.getPropertyValue(prop))
      const css = (v) => (/^-?\d+(\.\d+)?$/.test(String(v).trim()) ? `${String(v).trim()}px` : String(v).trim())
      const input = h('input', { type: 'text', inputmode: 'decimal', value: value === 'Mixed' ? '' : shown, 'aria-label': title, spellcheck: 'false' })
      const box = h('div', { id: 'num-field', role: 'dialog', 'aria-label': title }, h('label', {}, title), input)
      const preview = () => { for (const el of els) el.style.setProperty(prop, css(input.value)) }
      const putBack = () => els.forEach((el, i) => (before[i] ? el.style.setProperty(prop, before[i]) : el.style.removeProperty(prop)))
      let done = false
      const finish = (keep) => {
        if (done) return
        done = true
        box.remove()
        putBack()
        if (keep && input.value.trim() && input.value.trim() !== shown) setStyle({ [prop]: css(input.value) })
      }
      input.addEventListener('input', preview)
      input.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(true)
        else if (e.key === 'Escape') finish(false)
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const n = parseFloat(input.value) || 0
          input.value = String(Math.max(0, n + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)))
          preview()
        }
      })
      input.addEventListener('blur', () => finish(true))
      document.body.append(box)
      const r = btn.getBoundingClientRect()
      box.style.left = `${Math.max(8, Math.min(innerWidth - box.offsetWidth - 8, r.left))}px`
      // On the far side of the toolbar from the selection, so the change it previews stays in sight.
      const selTop = rectOn(sel.frame, els[0]).y
      box.style.top = `${r.bottom <= selTop + 2 ? Math.max(8, r.top - box.offsetHeight - 6) : r.bottom + 6}px`
      input.focus()
      input.select()
    }
    return btn
  }
  function placeFloat() {
    if (!floatBar.classList.contains('open') || !sel?.frame.doc || !primary()?.isConnected) return
    const f = sel.frame
    const b = rectOn(f, primary())
    const w = floatBar.offsetWidth
    const hh = floatBar.offsetHeight
    const maxLeft = innerWidth - w - 8 - (document.body.classList.contains('panel-open') && innerWidth > 640 ? 320 : 0)
    const clamp = (c) => ({ x: Math.max(8, Math.min(maxLeft, c.x)), y: Math.min(innerHeight - 100, Math.max(56, c.y)) })
    // Above (clear of the selection's name tag), below, or to the right: whichever covers least of the
    // prototype's text and pictures, and never the selection itself; above when they tie.
    const spots = [{ x: b.x, y: b.y - hh - 30 }, { x: b.x, y: b.y + b.h + 10 }, { x: b.x + b.w + 12, y: b.y + b.h / 2 - hh / 2 }].map(clamp)
    const k = f.s * dc.view.z
    const o = dc.toScreen(f.x, f.y)
    const ink = inkOf(f).map((r) => ({ x: o.x + r.x * k, y: o.y + r.y * k, w: r.w * k, h: r.h * k }))
    const over = (a, c) => Math.max(0, Math.min(a.x + a.w, c.x + w) - Math.max(a.x, c.x)) * Math.max(0, Math.min(a.y + a.h, c.y + hh) - Math.max(a.y, c.y))
    // The selection and its name tag just above it are never to be covered.
    // The tag sits on the selection's top left; it may not be drawn yet, so only its width is read, when it is.
    const tag = { x: b.x, y: b.y - 24, w: overlay.querySelector('.ov.sel .ov-tag')?.offsetWidth || 240, h: 24 }
    const cost = (c) => (over(b, c) + over(tag, c)) * 20 + ink.reduce((s, r) => s + over(r, c), 0)
    const costs = spots.map(cost)
    let at = 0
    for (let i = 1; i < spots.length; i++) if (costs[i] < costs[at] - 1) at = i
    // The same selection keeps its spot while typing or panning, unless that spot comes to cover clearly more.
    if (lastSpot.el === primary() && costs[lastSpot.at] <= costs[at] + 400) at = lastSpot.at
    lastSpot = { el: primary(), at }
    const best = spots[at]
    floatBar.style.left = `${best.x}px`
    floatBar.style.top = `${best.y}px`
  }
  // On a narrow screen the toolbar scrolls sideways: a mouse wheel over it scrolls it, rather than zooming the board.
  floatBar.addEventListener('wheel', (e) => {
    if (floatBar.scrollWidth <= floatBar.clientWidth) return
    e.preventDefault()
    e.stopPropagation()
    floatBar.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  }, { passive: false })
  /** The selected frame's text and pictures, outside the selection, in its own pixels; kept until the selection or the page changes. */
  let inkCache = null
  let lastSpot = { el: null, at: 0 }
  function inkOf(f) {
    const el = primary()
    const size = f.doc.body.innerHTML.length
    if (inkCache && inkCache.el === el && inkCache.doc === f.doc && inkCache.size === size) return inkCache.rects
    const rects = []
    const chosen = sel.els
    const walker = f.doc.createTreeWalker(f.doc.body, NodeFilter.SHOW_ELEMENT)
    for (let n = walker.nextNode(); n && rects.length < 1500; n = walker.nextNode()) {
      if (chosen.some((c) => c === n || c.contains(n) || n.contains(c))) continue
      const media = /^(img|svg|video|canvas|input|button|select|textarea|iframe)$/.test(n.localName)
      if (!media && !ownText(n)) continue
      const r = n.getBoundingClientRect()
      if (r.width && r.height) rects.push({ x: r.left, y: r.top, w: r.width, h: r.height })
    }
    inkCache = { el, doc: f.doc, size, rects }
    return rects
  }
  /** The text styles the prototype already uses: each tag and class pairing that holds text, with its font. */
  function textStyles(anchor) {
    const doc = sel.frame.doc
    // One row a look (font, size, weight, line height, spacing), not a tag: two paragraphs styled by their context
    // (.hero p, .card p) are two styles. Each is named where it is first used, with how many lines have it.
    const lookOf = (el) => {
      const c = cs(el)
      return { family: c.fontFamily, size: c.fontSize, weight: c.fontWeight, line: c.lineHeight, spacing: c.letterSpacing }
    }
    const keyOf = (s) => [s.family, s.size, s.weight, s.line, s.spacing].join('|')
    const whereOf = (el) => {
      const own = `${el.localName}${el.classList[0] ? `.${el.classList[0]}` : ''}`
      if (el.classList[0]) return own
      for (let p = el.parentElement, i = 0; p && p !== doc.body && i < 3; p = p.parentElement, i++) if (p.classList[0]) return `.${p.classList[0]} ${own}`
      return own
    }
    const seen = new Map()
    for (const el of doc.body.querySelectorAll('*')) {
      if (!ownText(el)) continue
      const s = lookOf(el)
      const k = keyOf(s)
      if (seen.has(k)) seen.get(k).count++
      else if (seen.size < 30) seen.set(k, { s, where: whereOf(el), count: 1 })
    }
    const mine = keyOf(lookOf(primary()))
    const lh = (s) => (s.line === 'normal' ? '' : `/${Math.round(parseFloat(s.line) * 10) / 10}px`)
    dc.openMenu(anchor, [...seen].map(([k, { s, where, count }]) => ({
      label: `${where} · ${s.family.split(',')[0].replace(/["']/g, '')} ${s.size}${lh(s)} ${s.weight}${count > 1 ? ` · ${count}` : ''}`,
      tick: k === mine,
      run: () => setStyle({ 'font-family': s.family, 'font-size': s.size, 'font-weight': s.weight, 'line-height': s.line, 'letter-spacing': s.spacing }),
    })))
  }
  async function link() {
    const el = primary()
    if (editing) {
      const at = editing
      linkInPlace(at, await askLink('Link to:', 'https://'))
      return
    }
    if (!needEditable()) return
    if (el.localName === 'a') {
      const href = await askLink('Link to (empty to remove the address):', el.getAttribute('href') || '')
      if (href != null) send({ op: 'attr', cv: cvOf(el), name: 'href', value: href })
      return
    }
    const href = await askLink('Link to:', '')
    if (!href) return
    const inner = el.innerHTML.replace(/\s+data-cv="\d+"/g, '')
    send({ op: 'inner', cv: cvOf(el), html: `<a href="${href.replace(/"/g, '&quot;')}">${inner}</a>` })
  }
  /** An address for a link, or null. A prototype runs in the canvas's own page, so an address that
      runs script (javascript:, vbscript:) or carries a page of its own (data:) is refused. */
  async function askLink(message, value) {
    const href = await dc.question(message, value)
    if (href == null) return null
    if (/^(javascript|vbscript|data):/i.test(href.replace(/[\u0000-\u0020]/g, ''))) {
      hint('That address would run a script. A link can be a web address, a #place on the page, mailto: or tel:.', 3500)
      return null
    }
    return href.trim()
  }
  /** A link made in text being typed: the dialog took the focus, so the text gets it back first, with its selection. */
  function linkInPlace(at, href) {
    if (!href || editing !== at) return
    at.el.focus()
    at.frame.doc.execCommand('createLink', false, href)
  }
  /** List: a paragraph becomes bullets, one per line; bullets become numbers; numbers become a
      paragraph again. The element keeps its own attributes (class, style, id) and its lines their markup. */
  function list() {
    const el = primary()
    listAs(el.localName === 'ul' ? 'ol' : el.localName === 'ol' ? 'p' : 'ul')
  }
  /** One line of text or a list made into bullets (ul), numbers (ol), or a paragraph (p); asked for the kind it already
      is, it goes back to a paragraph. */
  function listAs(want) {
    const el = primary()
    if (!needEditable()) return
    const isList = el.localName === 'ul' || el.localName === 'ol'
    if (sel.els.length !== 1 || !(isList || isText(el))) return hint('Select one line of text or a list.', 1600)
    if (want === el.localName) want = 'p'
    if (want === 'p' && !isList) return
    const attrs = [...el.attributes].filter((a) => !['data-cv', 'contenteditable', 'spellcheck'].includes(a.name)).map((a) => ` ${a.name}="${a.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('')
    const clean = (html) => html.replace(/\s+data-cv="\d+"/g, '').trim()
    let html
    if (isList && want !== 'p') html = `<${want}${attrs}>${clean(el.innerHTML)}</${want}>`
    else if (isList) html = `<p${attrs}>${[...el.children].map((li) => clean(li.innerHTML)).join('<br>')}</p>`
    else {
      const lines = clean(el.innerHTML).split(/<br\s*\/?>|\n/i).map((l) => l.trim()).filter(Boolean)
      html = `<${want}${attrs}>${lines.map((l) => `<li>${l}</li>`).join('')}</${want}>`
    }
    send({ op: 'outer', cv: cvOf(el), html })
  }
  /** Strikethrough on or off for what is selected, as Figma's Ctrl+Shift+X; an underline already there stays. */
  function strike() {
    if (!needEditable() || !sel.els.some(isText)) return
    const lines = cs(primary()).textDecorationLine.split(/\s+/).filter((l) => l && l !== 'none')
    const on = lines.includes('line-through')
    const rest = lines.filter((l) => l !== 'line-through')
    toggleStyle('text-decoration-line', !on, [...rest, 'line-through'].join(' '), rest.join(' ') || 'none', (v) => v.includes('line-through'))
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
            { label: 'Add auto layout', key: 'Shift+A', run: ops.autoLayout },
            { label: 'Wrap in flex row', run: () => ops.wrapIn('row') },
            { label: 'Wrap in flex column', run: () => ops.wrapIn('column') },
            { label: 'Wrap in grid', run: () => ops.wrapIn('grid') },
            sel.els.length === 1 && !componentOf(primary()) && primary().localName !== 'body' ? { label: 'Make component…', key: 'Ctrl+Alt+K', run: ops.makeComponent } : null,
            sel.els.length === 1 && componentOf(primary())?.root === primary() ? { label: componentOf(primary()).variant ? 'Rename variant…' : 'Make a variant…', run: ops.variant } : null,
            ...(sel.els.length === 1 && componentOf(primary())?.root === primary()
              ? (() => {
                  const c = componentOf(primary())
                  const others = [...new Set(c.copies.map((x) => x.getAttribute('data-variant')?.trim() ?? ''))].filter((v) => v !== c.variant)
                  return others.map((v) => ({ label: `Switch to ${v || 'the main one'}`, run: () => ops.switchVariant(v) }))
                })()
              : []),
            sel.els.length === 1 && componentOf(primary())?.root === primary() ? { label: 'Detach from component', run: ops.detach } : null,
            { label: 'Cut', key: 'Ctrl+X', run: ops.cut },
            { label: 'Copy', key: 'Ctrl+C', run: ops.copy },
            clip ? { label: 'Paste after it', key: 'Ctrl+V', run: ops.paste } : null,
            clip && sel.els.length === 1 && primary().localName !== 'body' ? { label: 'Paste to replace it', key: 'Ctrl+Shift+R', run: ops.pasteReplace } : null,
            sel.els.length === 1 && primary().localName !== 'body' ? { label: 'Bring forward', key: 'Ctrl+]', run: () => ops.restack(true, false) } : null,
            sel.els.length === 1 && primary().localName !== 'body' ? { label: 'Bring to front', key: 'Ctrl+Shift+]', run: () => ops.restack(true, true) } : null,
            sel.els.length === 1 && primary().localName !== 'body' ? { label: 'Send backward', key: 'Ctrl+[', run: () => ops.restack(false, false) } : null,
            sel.els.length === 1 && primary().localName !== 'body' ? { label: 'Send to back', key: 'Ctrl+Shift+[', run: () => ops.restack(false, true) } : null,
            { label: 'Copy properties', key: 'Ctrl+Alt+C', run: ops.copyProps },
            look ? { label: 'Paste properties', key: 'Ctrl+Alt+V', run: ops.pasteProps } : null,
          ]
        : []),
      // Figma's Copy as code: the part's HTML, or the CSS that applies to it, locked or not.
      primary().localName !== 'body' ? { label: 'Copy as HTML', run: () => dc.copyHtml(primary(), sel.frame) } : null,
      primary().localName !== 'body' ? { label: 'Copy CSS', run: () => dc.copyCss(primary()) } : null,
      // A link that opens the canvas on this screen, as Figma's Copy link to a frame.
      { label: 'Copy link to this screen', run: async () => {
        const url = `${location.origin}${location.pathname}#page=${encodeURIComponent(dc.page)}&screen=${encodeURIComponent(sel.frame.key)}`
        try {
          await navigator.clipboard.writeText(url)
          hint('Link copied. It opens the canvas on this screen.', 1800)
        } catch {
          hint(url, 8000)
        }
      } },
      // A picture of it, locked or not.
      dc.serve && !dc.local ? { label: 'Copy as PNG', key: 'Ctrl+Shift+C', run: ops.copyPng } : null,
      dc.serve && !dc.local ? { label: 'Export PNG', run: () => ops.exportPng() } : null,
      dc.serve && !dc.local ? { label: 'Export the screen as PDF', run: ops.exportPdf } : null,
      sel.els.length > 1 ? { label: 'Select this one alone', run: () => select(sel.frame, [primary()]) } : null,
      copiesOf(primary()).length > 1 && sel.els.length === 1 ? { label: 'Select every copy', key: 'Ctrl+Alt+A', run: () => select(sel.frame, copiesOf(primary())) } : null,
      // Figma's Select all with the same properties: everything on this screen with the selected element's fill, border
      // (stroke), shadow (effect), text color, or type (font, size and weight).
      ...(sel.els.length === 1 && primary().localName !== 'body' ? [['fill', 'Select all with the same fill'], ['stroke', 'Select all with the same border'], ['effect', 'Select all with the same shadow'], ['color', 'Select all with the same text color'], ['type', 'Select all with the same type']].map(([how, label]) => {
        const same = sameAs(primary(), how)
        return same.length > 1 ? { label: `${label} (${same.length})`, run: () => select(sel.frame, [primary(), ...same.filter((x) => x !== primary())]) } : null
      }).filter(Boolean) : []),
      componentOf(primary())?.copies.length > 1 && sel.els.length === 1 ? { label: `Select all ${componentOf(primary()).copies.length} ${componentOf(primary()).name}`, run: () => { const c = componentOf(primary()); select(sel.frame, [c.root, ...c.copies.filter((x) => x !== c.root)]) } } : null,
      dc.commenting || can ? '-' : null,
      dc.commenting ? { label: 'Ask agent about it', run: () => dc.openAsk() } : null,
      can ? { label: 'Delete', key: 'Del', danger: true, run: ops.remove } : null,
    ].filter(Boolean))
  }

  // ── what panel.js works through ──
  const api = {
    get sel() { return sel },
    get editing() { return editing },
    primary, select, pick, setStyle, send, listAs, sendSheet, everyCopy, reselect, setHidden, refreshFloat: () => renderFloat(), ops, undo, climb, cvOf, editable, nameOf, isText, cs, boxOf, sizeOf, copiesOf, copiesSelector, rgbHex, meshOf, meshCss, gridOf, writeGrid, regrid, shared, notEditable, anchorFor,
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
