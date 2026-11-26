// The right panel: layers (the page's board objects and frames, then the selected frame's DOM),
// Properties (the selection's CSS in sections), Code (its declarations, attributes, what it
// inherits, and its source HTML) and Tweaks (the prototype's declared levers).
;(() => {
  const dc = window.designCanvas
  const ed = dc.editor
  const { h, hooks } = dc
  const $ = (s) => document.querySelector(s)
  const cs = ed.cs
  const px = (v) => (/^-?\d+(\.\d+)?$/.test(String(v).trim()) ? `${String(v).trim()}px` : String(v).trim())
  const num = (v) => {
    const n = parseFloat(v)
    return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : ''
  }

  // ── layers ──
  const open = new WeakSet()
  const openFrames = new Set()
  let tweaksFrame = null
  const layersEl = () => (dc.currentTab() === 'code' ? $('#layers-c') : $('#layers-p'))
  function renderLayers() {
    const host = layersEl()
    $('#layers-p').replaceChildren()
    $('#layers-c').replaceChildren()
    const sel = ed.sel
    if (sel) {
      openFrames.add(sel.frame.key)
      for (let k = ed.primary()?.parentElement; k; k = k.parentElement) open.add(k)
    }
    const rows = []
    for (const it of dc.items) {
      const label = { note: 'Note', title: 'Title', rect: 'Rectangle', ellipse: 'Ellipse', section: 'Section', line: 'Line', arrow: 'Arrow', pencil: 'Drawing', guide: 'Layout guide' }[it.kind] ?? it.kind
      rows.push(h('button', { type: 'button', class: 'lrow board', style: '--d:0', onclick: () => { ed.select(null, []); dc.pickItem(it.id) } },
        h('span', { class: 'tw' }), h('span', { class: 'lk' }, '◇'), h('span', { class: 'ln' }, `${label}${it.text ? ` "${it.text.slice(0, 18)}${it.text.length > 18 ? '…' : ''}"` : ''}`)))
    }
    let count = 0
    for (const f of dc.frames) {
      const isOpen = openFrames.has(f.key)
      rows.push(h('button', { type: 'button', class: `lrow lframe${sel?.frame === f && sel.els[0]?.localName === 'body' ? ' on' : ''}`, style: '--d:0', onclick: () => { if (f.doc) ed.select(f, [f.doc.body]) } },
        h('span', { class: 'tw', onclick: (e) => { e.stopPropagation(); isOpen ? openFrames.delete(f.key) : openFrames.add(f.key); renderLayers() } }, isOpen ? '▾' : '▸'),
        h('span', { class: 'lk' }, '#'), h('span', { class: 'ln' }, f.label)))
      if (!isOpen || !f.doc?.body) continue
      const walk = (el, d) => {
        for (const c of el.children) {
          if (ed.SKIP.has(c.localName) || count > 1500) continue
          count++
          const kids = [...c.children].filter((k) => !ed.SKIP.has(k.localName))
          const on = sel?.frame === f && sel.els.includes(c)
          const n = ed.nameOf(c)
          const row = h('button', { type: 'button', class: `lrow${on ? ' on' : ''}${ed.cvOf(c) == null ? ' runtime' : ''}`, style: `--d:${d}`, title: ed.cvOf(c) == null ? 'Made by the prototype\'s own script: can be inspected, not edited' : '',
            onclick: (e) => ed.pick(f, c, { add: e.shiftKey, copies: e.altKey }),
            onpointerenter: () => ed.hover(f, c), onpointerleave: () => ed.hover(null, null) },
            h('span', { class: 'tw', onclick: (e) => { e.stopPropagation(); open.has(c) ? open.delete(c) : open.add(c); renderLayers() } }, kids.length ? (open.has(c) ? '▾' : '▸') : ''),
            h('span', { class: 'lk' }, c.localName === 'a' ? dc.icon('link') : kindGlyph(n.kind)),
            h('span', { class: 'ln' }, n.text),
            dc.serve && ed.cvOf(c) != null ? eyeOf(f, c) : null)
          if (cs(c).display === 'none') row.classList.add('hidden-layer')
          if (dc.serve && ed.cvOf(c) != null) layerDrag(row, f, c, kids.length > 0 || CONTAINS.test(c.localName))
          rows.push(row)
          if (kids.length && open.has(c)) walk(c, d + 1)
        }
      }
      walk(f.doc.body, 1)
    }
    host.append(h('div', { class: 'lhead' }, 'Layers'), h('div', { class: 'lbody' }, rows.length ? rows : h('div', { class: 'empty' }, 'Nothing on this page.')))
    host.querySelector('.lrow.on:not(.lframe)')?.scrollIntoView({ block: 'nearest' })
  }
  /** Hide or show a layer, as Figma's eye: hidden is `display: none` on the element, so Play hides it too; shown
      takes that off, or, when its class hides it, puts back the display its tag would have. */
  function eyeOf(f, el) {
    const hidden = cs(el).display === 'none'
    return h('span', { class: 'eye', role: 'button', title: hidden ? 'Show' : 'Hide', onclick: (e) => {
      e.stopPropagation()
      let display = 'none'
      if (hidden) {
        const own = el.style.getPropertyValue('display')
        el.style.removeProperty('display')
        display = cs(el).display === 'none' ? 'revert' : ''
        if (own) el.style.setProperty('display', own)
      }
      ed.send({ op: 'style', cv: ed.cvOf(el), props: { display } }, { file: f.file, key: f.key })
    } }, dc.icon(hidden ? 'eyeOff' : 'eye'))
  }
  // A layer dragged onto another goes before it, after it, or (on the middle of one that holds others) inside it,
  // as one move in the file; double-click names it (data-name), as Figma renames a layer.
  const CONTAINS = /^(div|section|main|header|footer|nav|aside|article|ul|ol|form|figure|details|fieldset|body)$/
  let dragging = null
  function layerDrag(row, f, el, holds) {
    row.draggable = true
    const zone = (e) => {
      const r = row.getBoundingClientRect()
      const y = (e.clientY - r.top) / r.height
      return holds && y > 0.3 && y < 0.7 ? 'inside' : y < 0.5 ? 'before' : 'after'
    }
    const clear = () => row.classList.remove('drop-before', 'drop-after', 'drop-inside')
    row.addEventListener('dragstart', (e) => {
      dragging = { f, el }
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', ed.nameOf(el).text)
      row.classList.add('dragging')
    })
    row.addEventListener('dragend', () => { dragging = null; row.classList.remove('dragging') })
    row.addEventListener('dragover', (e) => {
      if (!dragging || dragging.f !== f || dragging.el === el || dragging.el.contains(el)) return
      e.preventDefault()
      clear()
      row.classList.add(`drop-${zone(e)}`)
    })
    row.addEventListener('dragleave', clear)
    row.addEventListener('drop', (e) => {
      clear()
      if (!dragging || dragging.f !== f || dragging.el === el || dragging.el.contains(el)) return
      e.preventDefault()
      const where = zone(e)
      const moved = dragging.el
      dragging = null
      ed.send({ op: 'move', cv: ed.cvOf(moved), target: ed.cvOf(el), where }, { file: f.file, key: f.key })
    })
    row.addEventListener('dblclick', async (e) => {
      e.preventDefault()
      const now = el.getAttribute('data-name') ?? ''
      const name = await dc.question('Layer name (empty for none):', now || ed.nameOf(el).text.replace(/^[.#◇]\s*|"[^"]*"/g, '').trim())
      if (name == null || name.trim() === now) return
      ed.send({ op: 'attr', cv: ed.cvOf(el), name: 'data-name', value: name.trim() || null }, { file: f.file, key: f.key })
    })
  }
  const kindGlyph = (k) => ({ Heading: 'H', Paragraph: '¶', Text: 'T', Button: '▭', Image: '▨', Vector: '✎', List: '☰', Item: '•', Row: '⇥', Column: '⇩', Grid: '▦', Field: '⎀', body: '#', named: '◆' }[k] ?? (k === 'group' ? '▢' : '§'))

  // ── properties ──
  const field = (label, ...control) => h('div', { class: 'pf' }, h('label', {}, label), h('div', { class: 'pc' }, ...control))
  const input = (value, onCommit, attrs = {}) => {
    const el = h('input', { value: value ?? '', ...attrs })
    el.addEventListener('change', () => onCommit(el.value))
    el.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') el.blur()
    })
    return el
  }
  const seg = (options, current, onPick) => h('div', { class: 'seg' }, ...options.map(([value, label, title]) => h('button', { type: 'button', title: title ?? label, 'aria-pressed': String(current === value), onclick: () => onPick(value) }, label)))
  const select = (options, current, onPick) => {
    const s = h('select', {}, ...options.map((o) => h('option', { value: o, selected: o === current }, o)))
    if (!options.includes(current)) s.prepend(h('option', { value: current, selected: true }, current))
    s.addEventListener('change', () => onPick(s.value))
    return s
  }
  const color = (value, onPick, onRemove, linked = null) => {
    const hex = ed.rgbHex(value)
    // Nothing set shows as an empty swatch, not as black.
    const clear = value === 'rgba(0, 0, 0, 0)' || value === 'transparent'
    const c = h('input', { type: 'color', value: clear ? '#ffffff' : hex, class: clear ? 'clear' : null, title: clear ? 'None: pick a colour' : linked ? `${linked}: a colour picked here takes this element off it` : null })
    // A colour written as a lever (var(--accent)) shows the lever, so a pick is a seen choice to leave it.
    const t = input(linked ?? (clear ? '' : hex.toUpperCase()), (v) => onPick(v), { placeholder: clear ? 'None' : '' })
    c.addEventListener('change', () => onPick(c.value))
    return h('div', { class: 'colorf' }, c, t, onRemove ? h('button', { type: 'button', class: 'mini', title: 'Remove', onclick: onRemove }, '−') : null)
  }
  const section = (title, adds, ...body) => h('section', { class: 'psec' }, h('header', {}, h('b', {}, title), adds ? h('button', { type: 'button', class: 'mini', title: `Add a property to ${title}`, onclick: (e) => addProp(e.currentTarget, adds) }, '+') : null), ...body)
  function addProp(anchor, props) {
    dc.openMenu(anchor, props.map((p) => ({ label: p, run: async () => {
      const v = await dc.question(`${p}:`, cs(ed.primary()).getPropertyValue(p))
      if (v != null) ed.setStyle({ [p]: v.trim() })
    } })))
  }
  // Every font: the prototype's own, then every font installed here (Chrome and Edge ask once),
  // or common ones where the browser cannot list them; each shown in itself.
  let installed = null
  const GENERIC = ['system-ui', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'ui-rounded', 'ui-serif', 'ui-monospace']
  // Well-known families on Windows and Mac. Those this computer has are found by drawing each
  // and comparing it with the fallbacks, which needs no permission and works in every browser.
  const KNOWN = ['Arial', 'Arial Black', 'Arial Narrow', 'Avenir', 'Avenir Next', 'Bahnschrift', 'Baskerville', 'Bodoni 72', 'Book Antiqua', 'Bookman Old Style', 'Calibri', 'Cambria', 'Cambria Math', 'Candara', 'Cascadia Code', 'Cascadia Mono', 'Century Gothic', 'Charter', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier', 'Courier New', 'Didot', 'Ebrima', 'Franklin Gothic Medium', 'Futura', 'Gabriola', 'Gadugi', 'Garamond', 'Geneva', 'Georgia', 'Gill Sans', 'Helvetica', 'Helvetica Neue', 'Hoefler Text', 'Impact', 'Ink Free', 'Javanese Text', 'Leelawadee UI', 'Lucida Console', 'Lucida Grande', 'Lucida Sans Unicode', 'Malgun Gothic', 'Marker Felt', 'Menlo', 'Microsoft Himalaya', 'Microsoft JhengHei', 'Microsoft New Tai Lue', 'Microsoft PhagsPa', 'Microsoft Sans Serif', 'Microsoft Tai Le', 'Microsoft YaHei', 'Microsoft Yi Baiti', 'MingLiU-ExtB', 'Mongolian Baiti', 'Monaco', 'MS Gothic', 'MV Boli', 'Myanmar Text', 'Nirmala UI', 'Optima', 'Palatino', 'Palatino Linotype', 'Papyrus', 'Rockwell', 'San Francisco', 'Segoe Fluent Icons', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Emoji', 'Segoe UI Historic', 'Segoe UI Symbol', 'Segoe UI Variable', 'SF Mono', 'SF Pro', 'SimSun', 'Sitka', 'Skia', 'Snell Roundhand', 'Sylfaen', 'Symbol', 'Tahoma', 'Times', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Webdings', 'Wingdings', 'Yu Gothic', 'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Source Sans Pro', 'Source Serif Pro', 'Fira Code', 'Fira Sans', 'JetBrains Mono', 'IBM Plex Sans', 'IBM Plex Mono', 'Noto Sans', 'Noto Serif', 'Outfit', 'DM Sans', 'Work Sans', 'Nunito', 'Raleway', 'Ubuntu', 'PT Sans', 'PT Serif', 'Merriweather', 'Playfair Display']
  const probe = () => {
    const ctx = document.createElement('canvas').getContext('2d')
    const sample = 'mmmmmmmmmmlliWW@#ab12'
    const width = (font) => {
      ctx.font = `72px ${font}`
      return ctx.measureText(sample).width
    }
    const base = ['monospace', 'serif', 'sans-serif'].map((b) => [b, width(b)])
    return KNOWN.filter((f) => base.some(([b, w]) => width(`"${f}", ${b}`) !== w))
  }
  async function fontMenu(anchor, own, pick) {
    if (!installed) {
      let listed = []
      if (typeof window.queryLocalFonts === 'function') {
        try {
          listed = (await window.queryLocalFonts()).map((f) => f.family)
        } catch {}
      }
      installed = [...new Set([...listed, ...probe()])].sort((a, b) => a.localeCompare(b))
    }
    const quote = (f) => (/^[\w-]+$/.test(f) ? f : `"${f.replace(/"/g, '')}"`)
    const row = (f, value) => ({ label: f, font: value, run: () => pick(value) })
    const ownNames = own.map((f) => f.split(',')[0].replace(/["']/g, '').trim())
    // Web fonts: downloaded once into the prototype's folder and linked from it, so they show for everyone who opens it.
    const web = dc.serve ? (dc.data.webFonts ?? []).filter(([f]) => !ownNames.includes(f)) : []
    const webRow = ([family]) => ({ label: family, run: () => useWebFont(family, pick) })
    dc.openMenu(anchor, [
      { note: 'In this prototype' },
      ...own.map((f, i) => row(ownNames[i], f)),
      '-',
      ...(web.length ? [{ note: `Web fonts, saved into the folder (${web.length})` }, ...web.map(webRow), '-'] : []),
      { note: `On this computer (${installed.length})` },
      ...installed.filter((f) => !ownNames.includes(f)).map((f) => row(f, quote(f))),
      '-',
      { note: 'Generic' },
      ...GENERIC.filter((f) => !ownNames.includes(f)).map((f) => row(f, f)),
    ])
  }
  /** A web font for the selection: its files fetched into the folder, its sheet linked, then the font set. */
  async function useWebFont(family, pick) {
    const sel = ed.sel
    if (!sel) return
    dc.hint(`Saving ${family} into the folder…`, 8000)
    let body
    try {
      const res = await fetch('/api/font', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: sel.frame.file, family }) })
      body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Could not get ${family} (${res.status})`)
    } catch (err) {
      return dc.hint(err.message, 4000)
    }
    dc.hint(`${family} saved in fonts/`, 1600)
    ed.send({ op: 'link', href: body.href, cv: ed.cvOf(ed.primary()) }, { file: sel.frame.file, key: sel.frame.key, copies: sel.els.length > 1, then: () => pick(body.value) })
  }
  /** The font dropdown: the current font, and every font when opened. */
  function fontBox(value, own, pick) {
    const name = value.split(',')[0].replace(/["']/g, '').trim()
    return h('button', { type: 'button', class: 'font-box', title: 'Every font', style: `font-family:${value}`, onclick: (e) => fontMenu(e.currentTarget, own, pick) }, h('span', {}, name), h('span', { class: 'caret' }, '▾'))
  }
  // Relative luminance and the contrast ratio, for a colour against what is painted behind it.
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const behind = (el) => {
    for (let k = el; k; k = k.parentElement) {
      const bg = cs(k).backgroundColor
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return ed.rgbHex(bg)
    }
    return '#ffffff'
  }
  function contrast(el) {
    const a = lum(ed.rgbHex(cs(el).color))
    const b = lum(behind(el))
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    const word = ratio >= 4.5 ? 'Good contrast' : ratio >= 3 ? 'Large text only' : 'Poor contrast'
    return h('div', { class: `contrast ${ratio >= 4.5 ? 'ok' : ratio >= 3 ? 'mid' : 'bad'}` }, `${word} · ${ratio.toFixed(1)}:1`)
  }
  let paddingSides = false
  let radiusCorners = false
  // ── states: hover, pressed and focus, shown on the board and written as the element's :hover (…) rule ──
  let state = 'default'
  let shownIn = null // the element now shown in a state, and its style
  const STATES = [['default', 'Default'], ['hover', 'Hover'], ['active', 'Pressed'], ['focus', 'Focus']]
  /** The rule a state is written to: the element's id, else its tag and classes (every element like it, as CSS states usually are). */
  const stateSelector = (el) => (el.id ? `#${CSS.escape(el.id)}` : el.classList.length ? ed.copiesSelector(el) : null)
  function clearStateShown() {
    if (!shownIn) return
    shownIn.el.removeAttribute?.('data-dc-state')
    shownIn.style.remove()
    shownIn = null
  }
  /** Shows the element as it looks in the state: every rule for it in that state, its own and the canvas's, applied as if the pointer were on it. */
  function showState(el) {
    clearStateShown()
    if (state === 'default' || !el?.isConnected) return
    const doc = el.ownerDocument
    const decls = []
    for (const sheet of doc.styleSheets) {
      let rules
      try { rules = sheet.cssRules } catch { continue }
      const walk = (list) => {
        for (const r of list) {
          if (r.cssRules && !r.selectorText) { walk(r.cssRules); continue }
          if (!r.selectorText?.includes(`:${state}`)) continue
          for (const one of r.selectorText.split(',')) {
            if (!one.includes(`:${state}`)) continue
            try { if (el.matches(one.replaceAll(`:${state}`, ''))) decls.push(r.style.cssText) } catch {}
          }
        }
      }
      walk(rules)
    }
    el.setAttribute('data-dc-state', state)
    const style = doc.createElement('style')
    style.textContent = `[data-dc-state][data-dc-state][data-dc-state] { ${decls.join(' ')} }`
    doc.head.append(style)
    shownIn = { el, style }
    // The toolbar reads the element as it now looks.
    ed.refreshFloat()
  }
  /** The rule a style change goes to while a state is shown, or null for the element itself. */
  dc.stateRuleFor = (el) => (state !== 'default' && shownIn?.el === el && stateSelector(el) ? `${stateSelector(el)}:${state}` : null)
  function renderProps() {
    const host = $('#props')
    host.replaceChildren()
    const el = ed.primary()
    if (!el) {
      clearStateShown()
      return host.append(h('div', { class: 'empty' }, 'Nothing selected. Click any element in the design to edit it here.'))
    }
    showState(el)
    // An entrance still playing would be read mid-way (opacity 0 at its start): it is run to its end, the
    // element's resting look. One that repeats for ever is left alone.
    for (const a of el.getAnimations?.() ?? []) {
      try { if (a.effect?.getComputedTiming().iterations !== Infinity) a.finish() } catch {}
    }
    const c = cs(el)
    const S = (p) => ed.shared(p)
    const stateRule = state === 'default' ? null : stateSelector(el)
    const set = (props) => (state === 'default' || stateRule ? ed.setStyle(props) : dc.hint('Give it an id or a class (Code tab) to style its states', 3000))
    const parent = el.parentElement
    const pc = parent ? cs(parent) : null
    const parentFlex = pc?.display.includes('flex')
    const parentRow = parentFlex && !pc.flexDirection.startsWith('column')
    const can = ed.sel.els.every(ed.editable)
    if (!can) host.append(h('div', { class: 'note' }, ed.notEditable(el), !dc.serve && dc.startLocal ? h('button', { type: 'button', class: 'btn start-edit', onclick: () => dc.startLocal() }, 'Edit here') : null))
    host.append(h('div', { class: 'ptitle' }, ed.nameOf(el).text, ed.sel.els.length > 1 ? h('small', {}, ed.everyCopy() ? ` · ${ed.sel.els.length} copies${can ? `: changes go to ${ed.copiesSelector(el)}` : ''}` : ` · ${ed.sel.els.length} selected${can ? ': changes go on each' : ''}`) : null))
    // Where it cannot be changed, its CSS is read out as text: nothing to click that does nothing.
    if (!can) {
      const r = el.getBoundingClientRect()
      const read = (label, value) => (value && value !== 'none' && value !== 'normal' && value !== 'rgba(0, 0, 0, 0)' ? field(label, h('span', { class: 'val' }, value)) : null)
      const pads = ['top', 'right', 'bottom', 'left'].map((s) => c.getPropertyValue(`padding-${s}`))
      host.append(
        h('section', { class: 'psec' }, h('header', {}, h('b', {}, 'Size')), read('Width', `${Math.round(r.width)}px`), read('Height', `${Math.round(r.height)}px`), c.position !== 'static' ? read('Position', c.position) : null),
        h('section', { class: 'psec' }, h('header', {}, h('b', {}, 'Layout')), read('Layout', c.display), c.display.includes('flex') ? read('Direction', c.flexDirection) : null, c.display.match(/flex|grid/) ? read('Gap', c.gap) : null, read('Padding', pads.every((p) => p === pads[0]) ? pads[0] : pads.join(' '))),
        ed.isText(el) ? h('section', { class: 'psec' }, h('header', {}, h('b', {}, 'Text')), read('Font', c.fontFamily), read('Weight · Size', `${c.fontWeight} · ${c.fontSize}`), read('Line height', c.lineHeight), read('Color', ed.rgbHex(c.color).toUpperCase()), contrast(el), read('Align', c.textAlign)) : null,
        h('section', { class: 'psec' }, h('header', {}, h('b', {}, 'Appearance')), read('Fill', c.backgroundColor === 'rgba(0, 0, 0, 0)' ? '' : ed.rgbHex(c.backgroundColor).toUpperCase()), c.opacity !== '1' ? read('Opacity', `${Math.round(c.opacity * 100)}%`) : null, read('Radius', c.borderRadius === '0px' ? '' : c.borderRadius), c.borderTopStyle !== 'none' ? read('Border', `${c.borderTopWidth} ${c.borderTopStyle} ${ed.rgbHex(c.borderTopColor).toUpperCase()}`) : null, read('Shadow', c.boxShadow)),
      )
      return
    }

    // Which state is being looked at and changed; outside Default, every change below goes into that state's rule.
    host.append(h('div', { class: 'state-row' },
      seg(STATES, state, (v) => { state = v; renderProps() }),
      state !== 'default' ? h('small', { class: 'state-note' }, stateRule ? `Shown ${STATES.find(([k]) => k === state)[1].toLowerCase()}; changes go to ${stateRule}:${state}` : 'Give it an id or a class (Code tab) to style its states') : null))
    // The align row: where it sits in its parent, the way its parent lays it out.
    const alignH = (where) => {
      if (parentFlex && !parentRow) return set({ 'align-self': { left: 'flex-start', center: 'center', right: 'flex-end' }[where] })
      if (parentRow) return set({ 'margin-left': where === 'left' ? '0' : 'auto', 'margin-right': where === 'right' ? '0' : 'auto' })
      if (c.display.startsWith('inline')) return parent && ed.editable(parent) ? ed.send({ op: 'style', cv: ed.cvOf(parent), props: { 'text-align': where } }) : null
      set({ 'margin-left': where === 'left' ? '0' : 'auto', 'margin-right': where === 'right' ? '0' : 'auto' })
    }
    const alignV = (where) => {
      if (parentRow) return set({ 'align-self': { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[where] })
      if (parentFlex) return set({ 'margin-top': where === 'top' ? '0' : 'auto', 'margin-bottom': where === 'bottom' ? '0' : 'auto' })
      dc.hint('Its parent is not a flex row, so it has no vertical place to take', 2500)
    }
    host.append(h('div', { class: 'alignrow' },
      ...['left', 'center', 'right'].map((w) => h('button', { type: 'button', class: 'mini', title: `Align ${w}`, onclick: () => alignH(w) }, h('span', { class: 'ag', 'data-a': `h-${w}` }))),
      h('span', { class: 'sep' }),
      ...['top', 'middle', 'bottom'].map((w) => h('button', { type: 'button', class: 'mini', title: `Align ${w}`, onclick: () => alignV(w) }, h('span', { class: 'ag', 'data-a': `v-${w}` })))))

    // Size
    // Sizes are shown as the box is drawn, padding and border included, as the label on the board
    // shows them; a content-box element's CSS width is that less its padding and border.
    const n = (v) => parseFloat(v) || 0
    const extra = (dim) => (c.boxSizing === 'border-box' ? 0 : dim === 'width'
      ? n(c.paddingLeft) + n(c.paddingRight) + n(c.borderLeftWidth) + n(c.borderRightWidth)
      : n(c.paddingTop) + n(c.paddingBottom) + n(c.borderTopWidth) + n(c.borderBottomWidth))
    const drawn = (dim) => Math.round((ed.boxOf?.(el) ?? el.getBoundingClientRect())[dim])
    const cssSize = (dim, outer) => `${Math.max(0, Math.round(Number(outer) - extra(dim)))}px`
    const sizeMode = (dim) => {
      const own = el.style.getPropertyValue(dim)
      const along = dim === 'width' ? parentRow : parentFlex && !parentRow
      if (/fit-content|max-content|min-content/.test(own)) return 'hug'
      if (own === '100%' || (along && Number(c.flexGrow) > 0)) return 'fill'
      if (/px$/.test(own)) return 'fixed'
      // No width of its own: a block outside a flex row stretches across its parent.
      if (dim === 'width' && !own && !parentRow && !c.display.startsWith('inline') && !['absolute', 'fixed'].includes(c.position) && c.float === 'none') return 'fill'
      return 'hug'
    }
    const setMode = (dim, mode) => {
      const along = dim === 'width' ? parentRow : parentFlex && !parentRow
      if (mode === 'hug') set({ [dim]: 'fit-content', ...(along ? { flex: '' } : {}) })
      else if (mode === 'fixed') set({ [dim]: cssSize(dim, drawn(dim)), ...(along ? { flex: '' } : {}) })
      else if (along) set({ flex: '1 1 0', [dim]: '' })
      else set({ [dim]: '100%' })
    }
    const dimRow = (dim, label) => field(label, input(String(drawn(dim)), (v) => set({ [dim]: /^\d+(\.\d+)?$/.test(String(v).trim()) ? cssSize(dim, v) : px(v) }), { class: 'n' }), seg([['hug', 'Hug'], ['fixed', 'Fixed'], ['fill', 'Fill']], sizeMode(dim), (m) => setMode(dim, m)))
    // The whole screen selected: its width is the screen's own (its canvas-width), as a Figma frame's is; its height
    // is measured from what it holds.
    const screen = el.localName === 'body' ? ed.sel.frame : null
    const setScreenWidth = (v) => {
      const w = Math.round(Number(String(v).replace(/px$/, '')))
      if (w >= 240 && w <= 3840) dc.setFrameWidth(screen, w)
      else dc.hint('A width from 240 to 3840', 2000)
    }
    if (screen) host.append(section('Screen', [],
      field('Width', input(String(screen.w), setScreenWidth, { class: 'n' }), seg(dc.ARTBOARD_SIZES.map(([name, w]) => [w, String(w), name]), screen.w, setScreenWidth)),
      field('Height', h('span', { class: 'val' }, `${Math.round(screen.h)} · from what it holds`))))
    host.append(section('Size', ['min-width', 'max-width', 'min-height', 'max-height', 'aspect-ratio', 'overflow', 'margin', 'z-index', 'inset'],
      screen ? null : dimRow('width', 'Width'),
      screen ? null : dimRow('height', 'Height'),
      field('Position', select(['static', 'relative', 'absolute', 'fixed', 'sticky'], c.position, (v) => set({ position: v }))),
      ['absolute', 'fixed', 'relative', 'sticky'].includes(c.position) ? field('Left · Top', input(num(c.left), (v) => set({ left: px(v) }), { class: 'n' }), input(num(c.top), (v) => set({ top: px(v) }), { class: 'n' })) : null,
      parentFlex ? field('Grow', input(c.flexGrow, (v) => set({ 'flex-grow': v }), { class: 'n' })) : null))

    // Layout
    const flex = c.display.includes('flex')
    const grid = c.display.includes('grid')
    const layout = [field('Layout', select(['block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'inline-block', 'inline', 'none', 'contents'], c.display, (v) => set({ display: v })))]
    if (flex) {
      const col = c.flexDirection.startsWith('column')
      layout.push(field('Direction', seg([['row', '→', 'Row'], ['column', '↓', 'Column']], col ? 'column' : 'row', (v) => set({ 'flex-direction': v })), seg([['wrap', '↩', 'Wrap']], c.flexWrap === 'wrap' ? 'wrap' : '', () => set({ 'flex-wrap': c.flexWrap === 'wrap' ? 'nowrap' : 'wrap' }))))
      const main = ['flex-start', 'center', 'flex-end']
      const ji = main.indexOf(c.justifyContent.replace(/^(start|normal|left)$/, 'flex-start').replace(/^(end|right)$/, 'flex-end'))
      const ai = main.indexOf(c.alignItems.replace(/^(start|normal|stretch)$/, 'flex-start').replace(/^end$/, 'flex-end'))
      const nine = h('div', { class: 'nine' })
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
        const [jm, am] = col ? [y, x] : [x, y]
        nine.append(h('button', { type: 'button', 'aria-pressed': String(jm === ji && am === ai), title: `${main[jm]} / ${main[am]}`, onclick: () => set({ 'justify-content': main[jm], 'align-items': main[am] }) }))
      }
      layout.push(field('Align', nine, seg([['space-between', '↔', 'Space between']], c.justifyContent, () => set({ 'justify-content': c.justifyContent === 'space-between' ? 'flex-start' : 'space-between' }))))
    }
    if (grid) layout.push(field('Columns', input(authored(el, 'grid-template-columns') ?? String(c.gridTemplateColumns.split(' ').length), (v) => set({ 'grid-template-columns': /^\d+$/.test(v.trim()) ? `repeat(${v.trim()}, 1fr)` : v }), { title: 'A number for that many equal columns, or any grid-template-columns' })))
    if (flex || grid) layout.push(field('Gap', input(lever(el, 'gap') ?? (num(c.rowGap) === num(c.columnGap) ? num(c.rowGap) : `${c.rowGap} ${c.columnGap}`), (v) => set({ gap: /var\(/.test(v) ? v.trim() : v.split(/\s+/).map(px).join(' ') }), { class: 'n' })))
    const pads = ['top', 'right', 'bottom', 'left'].map((s) => num(c.getPropertyValue(`padding-${s}`)))
    const uniform = pads.every((p) => p === pads[0])
    layout.push(paddingSides || !uniform
      ? field('Padding', ...['top', 'right', 'bottom', 'left'].map((s, i) => input(pads[i], (v) => set({ [`padding-${s}`]: px(v) }), { class: 'n s', title: s })), h('button', { type: 'button', class: 'mini', title: 'One value', onclick: () => { paddingSides = false; renderProps() } }, '▢'))
      : field('Padding', input(lever(el, 'padding') ?? pads[0], (v) => set({ padding: px(v) }), { class: 'n' }), h('button', { type: 'button', class: 'mini', title: 'Each side', onclick: () => { paddingSides = true; renderProps() } }, '⊞')))
    if (!flex) layout.push(h('div', { class: 'wraps' }, ...[['row', 'Wrap in flex row'], ['column', 'Wrap in flex column'], ['grid', 'Wrap in grid']].map(([k, l]) => h('button', { type: 'button', class: 'chipbtn', onclick: () => ed.ops.wrapIn(k) }, l))))
    host.append(section('Layout', ['margin', 'flex-basis', 'order', 'justify-items', 'align-content', 'grid-template-rows', 'grid-column', 'grid-row'], ...layout))

    // Text
    if (ed.isText(el) || ['input', 'textarea', 'select', 'button'].includes(el.localName)) {
      const fams = [...new Set([...el.ownerDocument.querySelectorAll('body *')].slice(0, 400).map((x) => cs(x).fontFamily))]
      const deco = c.textDecorationLine
      host.append(section('Text', ['font-style', 'text-transform', 'white-space', 'text-shadow', 'word-spacing', 'text-indent', 'font-variant'],
        field('Style', h('span', { class: 'val' }, el.classList[0] ? `.${el.classList[0]}` : el.localName)),
        field('Font', fontBox(S('font-family'), fams, (v) => set({ 'font-family': v }))),
        field('Weight', select(['100', '200', '300', '400', '500', '600', '700', '800', '900'], S('font-weight'), (v) => set({ 'font-weight': v })), input(num(S('font-size')), (v) => set({ 'font-size': px(v) }), { class: 'n', title: 'Size' })),
        field('Line · Letter', input(S('line-height') === 'normal' ? 'normal' : num(S('line-height')), (v) => set({ 'line-height': v === 'normal' ? 'normal' : px(v) }), { class: 'n', title: 'Line height' }), input(S('letter-spacing') === 'normal' ? 'normal' : num(S('letter-spacing')), (v) => set({ 'letter-spacing': v === 'normal' ? 'normal' : px(v) }), { class: 'n', title: 'Letter spacing' })),
        field('Color', color(S('color'), (v) => set({ color: v }), null, lever(el, 'color'))),
        contrast(el),
        field('Emphasis', seg([['underline', 'U̲', 'Underline'], ['line-through', 'S̶', 'Strikethrough']], deco.includes('underline') ? 'underline' : deco.includes('line-through') ? 'line-through' : '', (v) => set({ 'text-decoration': deco.includes(v) ? 'none' : v }))),
        field('Align', seg([['left', '⇤', 'Left'], ['center', '↔', 'Centre'], ['right', '⇥', 'Right'], ['justify', '☰', 'Justify']], c.textAlign === 'start' ? 'left' : c.textAlign, (v) => set({ 'text-align': v })))))
    }

    // Appearance
    const bg = S('background-color')
    const radii = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((k) => num(c.getPropertyValue(`border-${k}-radius`)))
    const sameR = radii.every((r) => r === radii[0])
    const op = Math.round(Number(c.opacity) * 100)
    const slider = h('input', { type: 'range', min: 0, max: 100, value: op })
    slider.addEventListener('input', () => { el.style.opacity = String(slider.value / 100) })
    slider.addEventListener('change', () => set({ opacity: String(slider.value / 100) }))
    host.append(section('Appearance', ['background', 'box-shadow', 'filter', 'backdrop-filter', 'mix-blend-mode', 'outline', 'cursor', 'overflow'],
      field('Fill', color(bg, (v) => set({ 'background-color': v }), bg !== 'rgba(0, 0, 0, 0)' ? () => set({ 'background-color': '', background: '' }) : null, lever(el, 'background-color') ?? lever(el, 'background'))),
      field('Opacity', slider, h('span', { class: 'val' }, `${op}%`)),
      radiusCorners || !sameR
        ? field('Radius', ...['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((k, i) => input(radii[i], (v) => set({ [`border-${k}-radius`]: px(v) }), { class: 'n s', title: k })), h('button', { type: 'button', class: 'mini', onclick: () => { radiusCorners = false; renderProps() } }, '▢'))
        : field('Radius', input(lever(el, 'border-radius') ?? radii[0], (v) => set({ 'border-radius': px(v) }), { class: 'n' }), h('button', { type: 'button', class: 'mini', title: 'Each corner', onclick: () => { radiusCorners = true; renderProps() } }, '⊞')),
      field('Border', seg([['none', 'None'], ['solid', 'Solid'], ['dashed', 'Dash'], ['dotted', 'Dot']], c.borderTopStyle, (v) => set(v === 'none' ? { border: 'none' } : { 'border-style': v, 'border-width': num(c.borderTopWidth) > 0 ? c.borderTopWidth : '1px', 'border-color': c.borderTopStyle === 'none' ? '#d1d5db' : c.borderTopColor }))),
      c.borderTopStyle !== 'none' ? field('Width · Color', input(num(c.borderTopWidth), (v) => set({ 'border-width': px(v) }), { class: 'n' }), color(c.borderTopColor, (v) => set({ 'border-color': v }))) : null,
      field('Shadow', input(c.boxShadow === 'none' ? '' : c.boxShadow, (v) => set({ 'box-shadow': v || 'none' }), { placeholder: '0 2px 8px rgba(0,0,0,.15)' })),
      motionField(el, c),
      ...entranceFields(el, c)))
  }
  /** How the element comes in when the page opens: a named @keyframes (written into the file with it), a speed and a delay. */
  const ENTRANCES = [
    ['none', 'None', ''],
    ['dc-fade', 'Fade', 'from { opacity: 0 } to { opacity: 1 }'],
    ['dc-rise', 'Rise', 'from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: none }'],
    ['dc-pop', 'Pop', 'from { opacity: 0; transform: scale(0.92) } to { opacity: 1; transform: none }'],
    ['dc-slide', 'Slide', 'from { opacity: 0; transform: translateX(-24px) } to { opacity: 1; transform: none }'],
    // Three keyframes: it rises past its place and settles back.
    ['dc-bounce', 'Bounce', 'from { opacity: 0; transform: translateY(24px) } 60% { opacity: 1; transform: translateY(-6px) } to { opacity: 1; transform: none }'],
  ]
  const ENTRANCE_SPEEDS = [['250', 'Quick'], ['450', 'Smooth'], ['800', 'Slow']]
  // Where each preset starts from, for Custom to begin with: opacity %, move x and y px, scale %, rotate deg.
  const ENTRANCE_FROM = { 'dc-fade': [0, 0, 0, 100, 0], 'dc-rise': [0, 0, 16, 100, 0], 'dc-pop': [0, 0, 0, 92, 0], 'dc-slide': [0, -24, 0, 100, 0], 'dc-bounce': [0, 0, 24, 100, 0] }
  const OWN_ENTRANCE = /^dc-in-[a-z0-9]+$/
  /** A custom entrance's first keyframe, read from its @keyframes in the page: [opacity %, x, y, scale %, rotate]. */
  function ownFrom(doc, name) {
    for (const sheet of doc.styleSheets) {
      let rules
      try { rules = sheet.cssRules } catch { continue }
      for (const r of rules) {
        if (r.type !== CSSRule.KEYFRAMES_RULE || r.name !== name) continue
        const first = [...r.cssRules].find((k) => k.keyText === '0%' || k.keyText === 'from')
        if (!first) continue
        const num = (t, re, d) => Number(re.exec(t)?.[1] ?? d)
        const t = first.style.transform
        // Up to two keyframes between the first and the last, in the order they come.
        const mids = [...r.cssRules].filter((k) => !['0%', 'from', '100%', 'to'].includes(k.keyText)).sort((a, b) => parseFloat(a.keyText) - parseFloat(b.keyText))
        const midOf = (k, at, dy) => {
          const m = k?.style.transform ?? ''
          return [k ? 1 : 0, num(m, /translate\((-?[\d.]+)px/, 0), num(m, /translate\([^,]+,\s*(-?[\d.]+)px/, k ? 0 : dy), Math.round(num(m, /scale\((-?[\d.]+)\)/, 1) * 100), k ? parseFloat(k.keyText) : at]
        }
        return [Math.round(Number(first.style.opacity || 1) * 100), num(t, /translate\((-?[\d.]+)px/, 0), num(t, /translate\([^,]+,\s*(-?[\d.]+)px/, 0), Math.round(num(t, /scale\((-?[\d.]+)\)/, 1) * 100), num(t, /rotate\((-?[\d.]+)deg/, 0),
          ...midOf(mids[0], 60, -6), ...midOf(mids[1], 85, 2)]
      }
    }
    return null
  }
  /** Entrance as a list: None, the presets, Custom (your own first keyframe). */
  function entrancePick(now, onPick) {
    const s = h('select', { title: 'How it comes in when the page opens' },
      ...[...ENTRANCES, ['custom', 'Custom…']].map(([k, label]) => h('option', { value: k, selected: k === now }, label)))
    s.addEventListener('change', () => onPick(s.value))
    return s
  }
  // The first keyframe, up to two between (each at its own moment, 5 to 95% of the way) when on, and the resting look.
  const ownCss = (f) => {
    const [o, x, y, s, r] = f
    const mid = (on, mx, my, ms, at) => (on ? [{ at: Math.min(95, Math.max(5, at)), css: `opacity: 1; transform: translate(${mx}px, ${my}px) scale(${ms / 100})` }] : [])
    const mids = [...mid(...f.slice(5, 10)), ...(f[5] ? mid(...f.slice(10, 15)) : [])].sort((a, b) => a.at - b.at)
    return `from { opacity: ${o / 100}; transform: translate(${x}px, ${y}px) scale(${s / 100}) rotate(${r}deg) }` +
      mids.map((m) => ` ${m.at}% { ${m.css} }`).join('') + ' to { opacity: 1; transform: none }'
  }
  function entranceFields(el, c) {
    const name = c.animationName.split(',')[0].trim()
    const now = ENTRANCES.some(([k]) => k === name) ? name : OWN_ENTRANCE.test(name) ? 'custom' : 'none'
    const ms = (d) => Math.round(parseFloat(d) * (d.trim().endsWith('ms') ? 1 : 1000) || 0)
    const dur = ms(c.animationDuration.split(',')[0])
    const delay = ms(c.animationDelay.split(',')[0])
    const speed = now === 'none' ? '450' : ENTRANCE_SPEEDS.reduce((a, b) => (Math.abs(b[0] - dur) < Math.abs(a[0] - dur) ? b : a))[0]
    const from = [...(now === 'custom' ? ownFrom(el.ownerDocument, name) ?? [0, 0, 16, 100, 0] : ENTRANCE_FROM[now] ?? [0, 0, 16, 100, 0])]
    // The middle keyframe: off, then x, y and scale for when it is on.
    for (const [i, d] of [[5, 0], [6, 0], [7, -6], [8, 100], [9, 60], [10, 0], [11, 0], [12, 2], [13, 100], [14, 85]]) from[i] ??= d
    const write =(k, t = speed, d = delay, f = from) => {
      if (k === 'custom') {
        const own = now === 'custom' ? name : `dc-in-${Math.random().toString(36).slice(2, 8)}`
        return ed.send({ op: 'style', cv: ed.cvOf(el), props: { animation: `${own} ${t}ms cubic-bezier(0.2, 0.7, 0.2, 1) ${d}ms both` }, keyframes: { [own]: ownCss(f) } })
      }
      const css = ENTRANCES.find(([key]) => key === k)[2]
      // Leaving Custom takes its own @keyframes out of the file with it.
      const frames = { ...(css ? { [k]: css } : {}), ...(now === 'custom' ? { [name]: null } : {}) }
      ed.send({ op: 'style', cv: ed.cvOf(el), props: { animation: css ? `${k} ${t}ms cubic-bezier(0.2, 0.7, 0.2, 1) ${d}ms both` : '' }, ...(Object.keys(frames).length ? { keyframes: frames } : {}) })
    }
    // The first keyframe, field by field; the last is always the element's own resting look.
    const fromField = (i, label, unit) => input(String(from[i]), (v) => {
      const f = [...from]
      f[i] = Math.round(Number(v) || 0)
      write('custom', speed, delay, f)
    }, { class: 'n s', title: `${label}${unit ? ` (${unit})` : ''}`, placeholder: label })
    // Scrubbing holds the entrance at a moment of it, on the board; ▷ plays it from the start again.
    const scrub = h('input', { type: 'range', min: 0, max: 100, value: 100, title: 'Scrub: hold it at a moment of the entrance' })
    scrub.addEventListener('input', () => {
      for (const a of el.getAnimations()) {
        if (a.animationName !== name) continue
        a.pause()
        a.currentTime = delay + (dur * Number(scrub.value)) / 100
      }
      // The selection's outline, tag and toolbar follow it to where it is held.
      hooks.onView?.()
    })
    // Every entrance on the screen plays again, so a stagger is seen as a whole.
    const replay = () => {
      for (const a of el.ownerDocument.getAnimations()) {
        if (a.effect?.getComputedTiming().iterations === Infinity) continue
        a.cancel()
        a.play()
      }
    }
    if (name !== 'none' && now === 'none') return [field('Entrance', h('span', { class: 'val' }, `${name} (the prototype's own)`))]
    return [
      field('Entrance', entrancePick(now, (k) => write(k)),
        now !== 'none' ? h('button', { type: 'button', class: 'mini', title: 'Play it again', onclick: replay }, '▷') : null),
      ...(now === 'custom' ? [
        field('Start opacity', fromField(0, 'Opacity', '%'), h('span', { class: 'val' }, '%')),
        field('Start scale', fromField(3, 'Scale', '%'), h('span', { class: 'val' }, '%')),
        field('Start turn', fromField(4, 'Rotate', 'deg'), h('span', { class: 'val' }, '°')),
        field('Start X · Y', fromField(1, 'X', 'px'), fromField(2, 'Y', 'px'), h('span', { class: 'val' }, 'px')),
        field('Middle', seg([['0', 'Off', 'Straight from the start to its place'], ['1', 'On', 'A keyframe on the way: past its place, or short of it']], String(from[5]), (v) => {
          const f = [...from]
          f[5] = Number(v)
          write('custom', speed, delay, f)
        })),
        ...(from[5] ? [
          field('Middle at', fromField(9, 'Middle at', '% of the way'), h('span', { class: 'val' }, '% of the way')),
          field('Middle X · Y', fromField(6, 'Middle X', 'px'), fromField(7, 'Middle Y', 'px'), h('span', { class: 'val' }, 'px')),
          field('Middle scale', fromField(8, 'Middle scale', '%'), h('span', { class: 'val' }, '%')),
          field('Another', seg([['0', 'Off', 'One keyframe on the way'], ['1', 'On', 'A second one on the way, as a settle after an overshoot']], String(from[10]), (v) => {
            const f = [...from]
            f[10] = Number(v)
            write('custom', speed, delay, f)
          })),
          ...(from[10] ? [
            field('Second at', fromField(14, 'Second at', '% of the way'), h('span', { class: 'val' }, '% of the way')),
            field('Second X · Y', fromField(11, 'Second X', 'px'), fromField(12, 'Second Y', 'px'), h('span', { class: 'val' }, 'px')),
            field('Second scale', fromField(13, 'Second scale', '%'), h('span', { class: 'val' }, '%')),
          ] : []),
        ] : []),
      ] : []),
      now !== 'none' ? field('Speed · Delay', seg(ENTRANCE_SPEEDS.map(([t, label]) => [t, label, `${t} ms`]), speed, (t) => write(now, t)),
        input(String(delay), (v) => write(now, speed, Math.max(0, Math.round(Number(v) || 0))), { class: 'n', title: 'Delay in ms, to come in after what is above it' })) : null,
      now !== 'none' ? field('Scrub', scrub) : null,
      now !== 'none' ? staggerField(el, name, dur, delay) : null,
    ]
  }
  /** Siblings like it (its tag and first class): the ones a stagger reaches, in page order. */
  const alikeOf = (el) => [...(el.parentElement?.children ?? [])].filter((c) => c.localName === el.localName && (c.classList[0] ?? '') === (el.classList[0] ?? ''))
  /** Stagger: every sibling like it takes the same entrance, each so many ms after the one before (from its own delay),
      in one edit; Off takes it off the others. The pick shows the step they have now. */
  function staggerField(el, name, dur, delay) {
    const alike = alikeOf(el)
    if (alike.length < 2 || alike.some((a) => ed.cvOf(a) == null)) return null
    const ms = (d) => Math.round(parseFloat(d) * (d.trim().endsWith('ms') ? 1 : 1000) || 0)
    const delays = alike.map((a) => (cs(a).animationName.split(',')[0].trim() === name ? ms(cs(a).animationDelay.split(',')[0]) : null))
    const step = delays.every((d) => d != null) ? delays[1] - delays[0] : 0
    const steady = step > 0 && delays.every((d, i) => d === delays[0] + i * step)
    const now = steady ? String(step) : 'off'
    const anim = (d) => `${name} ${dur}ms cubic-bezier(0.2, 0.7, 0.2, 1) ${d}ms both`
    // The first of them starts when this one would; each after it so many ms later.
    const base = steady ? delays[0] : delay
    const pick = (k) => {
      const items = alike.map((a, i) => ({ cv: ed.cvOf(a), props: { animation: k === 'off' ? (a === el ? anim(delay) : '') : anim(base + i * Number(k)) } }))
      ed.send({ op: 'styles', items }, { file: ed.sel.frame.file, key: ed.sel.frame.key })
    }
    return field(`Stagger ${alike.length}`, seg([['off', 'Off', 'Only this one comes in'], ['60', '60', `All ${alike.length} alike, 60 ms apart`], ['120', '120', `All ${alike.length} alike, 120 ms apart`], ['200', '200', `All ${alike.length} alike, 200 ms apart`]], now, pick), h('span', { class: 'val' }, 'ms'))
  }
  /** How fast it changes into a state and back: CSS transition on the element itself, whatever state is shown. */
  function motionField(el, c) {
    const ms = Math.max(...c.transitionDuration.split(',').map((d) => parseFloat(d) * (d.trim().endsWith('ms') ? 1 : 1000) || 0))
    const SPEEDS = [['none', 'None', 0], ['quick', 'Quick', 150], ['smooth', 'Smooth', 250], ['slow', 'Slow', 400]]
    const now = ms ? SPEEDS.slice(1).reduce((a, b) => (Math.abs(b[2] - ms) < Math.abs(a[2] - ms) ? b : a))[0] : 'none'
    return field('Motion', seg(SPEEDS.map(([k, label, t]) => [k, label, t ? `${label}: ${t} ms into and out of each state` : 'No motion']), now, (k) => {
      const t = SPEEDS.find(([key]) => key === k)[2]
      ed.send({ op: 'style', cv: ed.cvOf(el), props: { transition: t ? `all ${t}ms ease-out` : '' } })
    }))
  }

  // ── code ──
  /** A rule's declarations as the browser writes them back, shorthands kept (`margin: 0px`, not four
      longhands; `background: …`, not a dozen of them set to `initial`). */
  function declsOf(style) {
    const out = []
    let part = ''
    let depth = 0
    let quote = ''
    for (const ch of style.cssText) {
      if (quote) quote = ch === quote ? '' : quote
      else if (ch === '"' || ch === "'") quote = ch
      else if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (ch === ';' && !depth) {
        out.push(part)
        part = ''
        continue
      }
      part += ch
    }
    out.push(part)
    return out.map((d) => d.trim()).filter(Boolean).map((d) => {
      const c = d.indexOf(':')
      return [d.slice(0, c).trim(), d.slice(c + 1).trim()]
    }).filter(([p]) => p)
  }
  /** A selector made comparable however it is spaced, as the server compares it. */
  const sameSelector = (s) => String(s).replace(/\s+/g, ' ').replace(/\s*([>+~,])\s*/g, '$1').trim()
  /** The declarations of the prototype's nth rule with a selector, as its <style> elements write them (`#0b6e6e`, not
   *  the browser's `rgb(11, 110, 110)`), by property. */
  function writtenDecls(doc, key, nth, sheet = null) {
    let seen = 0
    for (const node of doc.querySelectorAll('style')) {
      // The prototype's own <style> elements, or the one linked sheet named.
      if (sheet != null ? node.getAttribute('data-dc-sheet') !== sheet : [...node.attributes].some((a) => a.name.startsWith('data-canvas') || a.name.startsWith('data-dc'))) continue
      const css = node.textContent.replace(/\/\*[\s\S]*?\*\//g, '')
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (sameSelector(m[1]) !== key || seen++ !== nth) continue
        const map = new Map()
        for (const d of m[2].split(';')) {
          const i = d.indexOf(':')
          if (i > 0) map.set(d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim())
        }
        return map
      }
    }
    return null
  }
  function rulesFor(el) {
    const out = []
    // A rule in one of the prototype's own <style> elements (not the canvas's) can be changed where it is written; it
    // is named to the server by its selector and its place among the rules with that selector, in file order.
    const seen = new Map()
    for (const sheet of el.ownerDocument.styleSheets) {
      let rules
      try { rules = sheet.cssRules } catch { continue }
      const node = sheet.ownerNode
      const own = node?.localName === 'style' && ![...node.attributes].some((a) => a.name.startsWith('data-canvas') || a.name.startsWith('data-dc'))
      // A stylesheet the prototype links, swapped in by the canvas and named by its file: changed in that file.
      const sheetName = node?.getAttribute?.('data-dc-sheet') ?? null
      const counted = own || sheetName != null
      const walk = (list, active) => {
        for (const r of list) {
          if (r.cssRules && !r.selectorText) {
            walk(r.cssRules, active && (!r.media || win(el).matchMedia(r.media.mediaText).matches))
            continue
          }
          if (!r.selectorText || !r.style) continue
          const key = sameSelector(r.selectorText)
          const slot = `${sheetName ?? ''}\n${key}`
          const nth = counted ? seen.get(slot) ?? 0 : null
          if (counted) seen.set(slot, nth + 1)
          if (!active) continue
          try { if (!el.matches(r.selectorText)) continue } catch { continue }
          const spec = splitList(r.selectorText).filter((s) => { try { return el.matches(s) } catch { return false } }).map(specificity).sort(bySpec).pop() ?? [0, 0, 0]
          const written = counted ? writtenDecls(el.ownerDocument, key, nth, sheetName) : null
          const decls = declsOf(r.style).map(([p, v]) => [p, written?.get(p) ?? v])
          out.push({ selector: r.selectorText, decls, spec, order: out.length, own, nth, sheet: sheetName })
        }
      }
      walk(rules, true)
    }
    // Weakest first, as the cascade applies them (the panel shows them strongest first).
    return out.sort((a, b) => bySpec(a.spec, b.spec) || a.order - b.order)
  }
  /** A property as the prototype wrote it for the element (its own style, else the strongest rule that sets it), not as the
      browser resolved it: `repeat(3, 1fr)`, not three pixel widths that would stop the grid stretching if written back. */
  function authored(el, prop) {
    const own = el.style.getPropertyValue(prop)
    if (own) return own
    const rules = rulesFor(el).reverse()
    const lost = overridden(el, rules)
    for (const [i, r] of rules.entries()) {
      const j = r.decls.findIndex(([p]) => p === prop)
      if (j >= 0 && !lost[i][j]) return r.decls[j][1].replace(/\s*!important$/, '')
    }
    return null
  }
  /** The value as written when it is a lever (`var(--gap)`), so the field shows the link and typing a number is a choice to break it. */
  const lever = (el, prop) => {
    const a = authored(el, prop)
    return a && /var\(/.test(a) ? a : null
  }
  /** A selector list split at its top-level commas. */
  function splitList(sel) {
    const out = []
    let depth = 0
    let at = 0
    for (let i = 0; i < sel.length; i++) {
      if (sel[i] === '(' || sel[i] === '[') depth++
      else if (sel[i] === ')' || sel[i] === ']') depth--
      else if (sel[i] === ',' && !depth) { out.push(sel.slice(at, i).trim()); at = i + 1 }
    }
    out.push(sel.slice(at).trim())
    return out
  }
  const bySpec = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
  /** Ids, classes (with attributes and pseudo-classes), types (with pseudo-elements). :where() counts nothing;
      :is(), :not() and :has() count their strongest argument. */
  function specificity(sel) {
    const n = [0, 0, 0]
    let s = sel.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '')
    s = s.replace(/:(is|not|has|matches)\(((?:[^()]|\([^()]*\))*)\)/g, (m, k, inner) => {
      const best = splitList(inner).map(specificity).sort(bySpec).pop() ?? [0, 0, 0]
      for (let i = 0; i < 3; i++) n[i] += best[i]
      return ''
    })
    s = s.replace(/\[[^\]]*\]/g, () => { n[1]++; return '' })
    s = s.replace(/::[\w-]+(\([^)]*\))?/g, () => { n[2]++; return '' })
    s = s.replace(/#[\w-]+/g, () => { n[0]++; return '' })
    s = s.replace(/\.[\w-]+/g, () => { n[1]++; return '' })
    s = s.replace(/:[\w-]+(\([^)]*\))?/g, () => { n[1]++; return '' })
    for (const t of s.split(/[\s>+~]+/)) if (/^[a-z][\w-]*$/i.test(t)) n[2]++
    return n
  }
  /** For rules listed strongest first, after the element's own style: which declarations a stronger one overrides. */
  function overridden(el, rules) {
    // The winner for each property: !important first, then the element's own style, then the strongest rule.
    const win = new Map()
    const offer = (p, imp, rank) => {
      const w = win.get(p)
      if (!w || imp > w.imp || (imp === w.imp && rank < w.rank)) win.set(p, { imp, rank })
    }
    for (const p of el.style) offer(p, el.style.getPropertyPriority(p) === 'important' ? 1 : 0, 0)
    const imp = (v) => (/!important\s*$/.test(v) ? 1 : 0)
    rules.forEach((r, i) => r.decls.forEach(([p, v]) => offer(p, imp(v), i + 1)))
    return rules.map((r, i) => r.decls.map(([p, v]) => { const w = win.get(p); return w.imp !== imp(v) || w.rank !== i + 1 }))
  }
  const win = (el) => el.ownerDocument.defaultView
  const INHERITED = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'text-align', 'text-transform', 'font-style', 'white-space', 'cursor']
  let sourceFor = null
  function renderCode() {
    const host = $('#code')
    host.replaceChildren()
    const el = ed.primary()
    if (!el) return host.append(h('div', { class: 'empty' }, 'Nothing selected. Click any element in the design to read its code here.'))
    const can = ed.editable(el)
    host.append(h('div', { class: 'ctitle' }, h('code', {}, `<${el.localName}>`), ` ${ed.isText(el) ? `"${el.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)}"` : ''}`))
    if (!can) host.append(h('div', { class: 'note' }, ed.notEditable(el), !dc.serve && dc.startLocal ? h('button', { type: 'button', class: 'btn start-edit', onclick: () => dc.startLocal() }, 'Edit here') : null))
    // Where it cannot be changed, the same reading as text.
    if (!can) {
      const own = [...el.style]
      if (own.length) host.append(h('div', { class: 'chead' }, 'Its own'), ...own.map((p) => h('div', { class: 'decl ro' }, h('span', { class: 'p' }, p), h('span', { class: 'v' }, el.style.getPropertyValue(p)))))
      const rules = rulesFor(el).reverse()
      const lost = overridden(el, rules)
      rules.forEach((r, i) => host.append(h('div', { class: 'chead' }, `From ${r.selector}`), ...r.decls.map(([p, v], j) => h('div', { class: `decl ro${lost[i][j] ? ' lost' : ''}`, title: lost[i][j] ? 'Overridden by a stronger rule above' : null }, h('span', { class: 'p' }, p), h('span', { class: 'v' }, v)))))
      const attrs = [...el.attributes].filter((a) => !['data-cv', 'style'].includes(a.name))
      if (attrs.length) host.append(h('div', { class: 'chead' }, 'Attributes'), ...attrs.map((a) => h('div', { class: 'decl ro' }, h('span', { class: 'p' }, `@${a.name}`), h('span', { class: 'v' }, a.value))))
      host.append(h('div', { class: 'chead' }, 'Source HTML'), h('pre', { class: 'source' }, el.outerHTML.replace(/\s+data-cv="\d+"/g, '')))
      return
    }
    // Its own declarations: the style attribute, editable one per line.
    const own = [...el.style].filter((p) => !p.startsWith('--dc'))
    const decl = (p, v, onCommit) => h('div', { class: 'decl' }, h('span', { class: 'p' }, p), input(v, onCommit, { class: 'v' }))
    host.append(h('div', { class: 'chead' }, 'Its own'),
      ...own.map((p) => decl(p, el.style.getPropertyValue(p), (v) => ed.setStyle({ [p]: v.trim() }))),
      newDecl((p, v) => ed.setStyle({ [p]: v })))
    const rules = rulesFor(el).reverse()
    const lost = overridden(el, rules)
    // A rule of the prototype's own changes where it is written, for every element it matches; the canvas's own
    // overrides and rules from elsewhere are read only, with + to set a value on the element itself.
    const ruleLocked = (sel) => { try { return [...el.ownerDocument.querySelectorAll(sel)].some((x) => x.closest('[data-locked]')) } catch { return true } }
    const setDecl = (r, p, v) => {
      if (ruleLocked(r.selector)) return dc.hint('That rule styles a locked part, so it stays as it is', 2600)
      // A rule of a stylesheet the prototypes link changes in that file, for every screen that links it.
      if (r.sheet != null) return ed.sendSheet(r.sheet, r.selector, r.nth, p, v.trim())
      ed.send({ op: 'decl', selector: r.selector, nth: r.nth, prop: p, value: v.trim(), cv: ed.cvOf(el) })
    }
    // A sheet outside the prototypes' folder is not the canvas's to write, and only a canvas served by node writes one.
    const writable = (r) => r.own || (r.sheet != null && !dc.local && !r.sheet.split('/').includes('..'))
    // How many screens link a sheet, counted once a sheet for this panel: a board can have a hundred screens.
    const linkCounts = new Map()
    const linkedBy = (sheet) => {
      if (!linkCounts.has(sheet)) linkCounts.set(sheet, Object.values(dc.data.files).filter((html) => html.includes(`__RC_ASSET__(${sheet})`) || html.includes(`data-dc-sheet="${sheet}"`)).length)
      return linkCounts.get(sheet)
    }
    for (const [i, r] of rules.entries()) {
      const count = writable(r) ? el.ownerDocument.querySelectorAll(r.selector).length : 0
      const screens = r.sheet != null ? linkedBy(r.sheet) : 0
      const where = r.sheet != null
        ? h('small', { title: writable(r) ? `A change here goes into ${r.sheet}, for every screen that links it` : `${r.sheet} is outside this folder, so it is read only here` }, ` · ${r.sheet}${screens > 1 ? `, linked by ${screens} screens` : ''}`)
        : r.own ? h('small', { title: 'A change here goes into this rule in the prototype, for every element it matches' }, ` · ${count} ${count === 1 ? 'element' : 'elements'}`) : null
      const head = h('div', { class: 'chead' }, `From ${r.selector}`, where)
      const plus = (p, v) => h('button', { type: 'button', class: 'mini', title: 'Set it on the element itself', onclick: () => ed.setStyle({ [p]: v.replace(/\s*!important$/, '') }) }, '+')
      host.append(head,
        ...r.decls.map(([p, v], j) => h('div', { class: `decl${writable(r) ? '' : ' ro'}${lost[i][j] ? ' lost' : ''}`, title: lost[i][j] ? 'Overridden by a stronger rule above' : null },
          h('span', { class: 'p' }, p),
          writable(r) ? input(v, (nv) => setDecl(r, p, nv), { class: 'v', 'aria-label': `${p} in ${r.selector}` }) : h('span', { class: 'v' }, v),
          plus(p, v))),
        ...(writable(r) ? [newDecl((p, v) => setDecl(r, p, v))] : []))
    }
    // Attributes
    const attrs = [...el.attributes].filter((a) => !['data-cv', 'style', 'contenteditable', 'spellcheck'].includes(a.name))
    host.append(h('div', { class: 'chead' }, 'Attributes'),
      ...attrs.map((a) => h('div', { class: 'decl' }, h('span', { class: 'p' }, `@${a.name}`), input(a.value, (v) => ed.send({ op: 'attr', cv: ed.cvOf(el), name: a.name, value: v }), { class: 'v' }))),
      newDecl((p, v) => ed.send({ op: 'attr', cv: ed.cvOf(el), name: p.replace(/^@/, ''), value: v }), '@name'))
    // What it inherits, by the ancestor that sets it.
    const from = new Map()
    const mine = cs(el)
    for (const p of INHERITED) {
      if (el.style.getPropertyValue(p)) continue
      let k = el
      while (k.parentElement && cs(k.parentElement).getPropertyValue(p) === mine.getPropertyValue(p) && k.parentElement.localName !== 'html') k = k.parentElement
      if (k === el) continue
      if (!from.has(k)) from.set(k, [])
      from.get(k).push([p, mine.getPropertyValue(p)])
    }
    for (const [k, list] of from) {
      host.append(h('div', { class: 'chead' }, `From ${ed.nameOf(k).text}`),
        ...list.map(([p, v]) => h('div', { class: 'decl ro' }, h('span', { class: 'p' }, p), h('span', { class: 'v' }, v), h('button', { type: 'button', class: 'mini', title: 'Set it on the element itself', onclick: () => ed.setStyle({ [p]: v }) }, '+'))))
    }
    // Its source, as the file has it.
    const area = h('textarea', { class: 'source', spellcheck: 'false', rows: 10 })
    area.value = el.outerHTML.replace(/\s+data-cv="\d+"/g, '')
    area.addEventListener('keydown', (e) => e.stopPropagation())
    host.append(h('div', { class: 'chead' }, 'Source HTML'), area,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', disabled: !can, onclick: () => ed.send({ op: 'outer', cv: ed.cvOf(el), html: area.value }) }, 'Apply')))
    if (dc.serve && can) {
      sourceFor = el
      fetch(`/api/source?f=${encodeURIComponent(ed.sel.frame.file)}&cv=${ed.cvOf(el)}`).then((r) => r.json()).then((b) => { if (sourceFor === el && b.html != null) area.value = b.html }).catch(() => {})
    }
  }
  function newDecl(onAdd, placeholder = 'property') {
    const p = h('input', { class: 'p', placeholder })
    const v = h('input', { class: 'v', placeholder: 'value' })
    // Enter and the change that follows it are one addition: the fields empty once it is sent.
    const go = () => {
      if (!p.value.trim() || !v.value.trim()) return
      const [name, value] = [p.value.trim(), v.value.trim()]
      p.value = v.value = ''
      onAdd(name, value)
    }
    for (const x of [p, v]) x.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') go()
    })
    v.addEventListener('change', go)
    return h('div', { class: 'decl add' }, p, v)
  }

  // ── tweaks ──
  function renderTweaks() {
    const host = $('#tweaks')
    host.replaceChildren()
    const f = ed.sel?.frame ?? tweaksFrame ?? dc.frames.find((x) => x.meta.levers?.length) ?? null
    if (!f) return host.append(h('div', { class: 'empty' }, 'Select a frame to see its tweaks.'))
    const levers = f.meta.levers ?? []
    host.append(h('div', { class: 'ptitle' }, f.label))
    if (!levers.length) {
      host.append(h('div', { class: 'empty' }, dc.commenting ? 'This design has no tweakable controls yet. Describe what you want to adjust and the agent will add levers for it.' : 'This design has no tweakable controls.'),
        dc.commenting ? h('div', { class: 'row pad' }, h('button', { type: 'button', class: 'btn', onclick: () => askForLevers(f) }, 'Ask the agent for levers')) : null)
      return
    }
    if (!f.doc) return host.append(h('div', { class: 'empty' }, 'Scroll the frame into view to load it.'))
    const root = f.doc.documentElement
    // Where a lever is declared, the last :root to declare it winning as in the cascade: a stylesheet the screens link
    // (changed there, so every screen linking it follows), or null for the prototype's own.
    const rootKey = sameSelector(':root')
    const homeOf = (name) => {
      let home = null
      for (const sheet of f.doc.styleSheets) {
        const node = sheet.ownerNode
        if (node?.localName !== 'style' || node.hasAttribute('data-canvas')) continue
        const linked = node.getAttribute('data-dc-sheet')
        let rules
        try { rules = sheet.cssRules } catch { continue }
        let nth = 0
        const walk = (list, top) => {
          for (const r of list) {
            if (r.cssRules && !r.selectorText) { walk(r.cssRules, false); continue }
            if (!r.selectorText || sameSelector(r.selectorText) !== rootKey) continue
            if (top && r.style.getPropertyValue(name)) home = linked == null ? null : { sheet: linked, nth }
            nth++
          }
        }
        walk(rules, true)
      }
      return home
    }
    for (const name of levers) {
      const value = cs(root).getPropertyValue(name).trim()
      if (!dc.serve) {
        host.append(field(name, h('span', { class: 'val' }, value)))
        continue
      }
      const home = homeOf(name)
      const commit = (v) => (home && !dc.local && !home.sheet.split('/').includes('..')
        ? ed.sendSheet(home.sheet, ':root', home.nth, name, v)
        : ed.send({ op: 'rule', selector: ':root', props: { [name]: v } }, { file: f.file, key: f.key }))
      const live = (v) => root.style.setProperty(name, v)
      host.append(field(name, leverControl(value, live, commit)))
    }
  }
  /** A colour lever keeps its alpha; a number lever gets a slider sized to its unit, beside a field for an exact value. */
  function leverControl(value, live, commit) {
    if (/^(#|rgb|hsl)/i.test(value)) {
      const ctx = document.createElement('canvas').getContext('2d')
      ctx.fillStyle = value
      const alpha = /^rgba/.test(ctx.fillStyle) ? Number(/,\s*([\d.]+)\)$/.exec(ctx.fillStyle)[1]) : 1
      const out = (hex) => {
        if (alpha === 1) return hex
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
        return `rgba(${r}, ${g}, ${b}, ${alpha})`
      }
      const c = h('input', { type: 'color', value: ed.rgbHex(value) })
      c.addEventListener('input', () => live(out(c.value)))
      c.addEventListener('change', () => commit(out(c.value)))
      return alpha === 1 ? c : h('div', { class: 'pc' }, c, h('span', { class: 'val' }, `${Math.round(alpha * 100)}% opaque`))
    }
    const m = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem|em|%|vw|vh|deg|ms|s)?$/.exec(value)
    if (!m) return input(value, commit)
    const n = Number(m[1])
    const unit = m[2] ?? ''
    let min, max, step
    if (!unit && n >= 0 && n <= 1 && !Number.isInteger(n)) [min, max, step] = [0, 1, 0.01]
    else {
      const span = Math.max({ rem: 4, em: 4, '%': 100, deg: 360, s: 2, ms: 1000, '': 10 }[unit] ?? 100, Math.ceil(Math.abs(n) * 4))
      ;[min, max] = [n < 0 ? -span : 0, span]
      step = unit === 'rem' || unit === 'em' || unit === 's' || (!unit && !Number.isInteger(n)) ? 0.05 : 1
    }
    const r = h('input', { type: 'range', min, max, step, value: n })
    const num = h('input', { type: 'number', step, value: n, 'aria-label': 'Exact value' })
    const tidy = (v) => String(Math.round(Number(v) * 1000) / 1000)
    r.addEventListener('input', () => { num.value = tidy(r.value); live(`${tidy(r.value)}${unit}`) })
    r.addEventListener('change', () => commit(`${tidy(r.value)}${unit}`))
    num.addEventListener('input', () => { if (num.value !== '') { r.value = num.value; live(`${tidy(num.value)}${unit}`) } })
    num.addEventListener('change', () => { if (num.value !== '') commit(`${tidy(num.value)}${unit}`) })
    return h('div', { class: 'pc lever' }, r, num, h('span', { class: 'val unit' }, unit))
  }
  async function askForLevers(f) {
    const name = dc.me || (await dc.question('Your name, to sign the request:')) || ''
    if (!name.trim()) return
    dc.setName(name)
    const res = await fetch('/api/canvas-comments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: { op: 'add', name, agent: true, frame: f.key, x: 24, y: 24, text: `Add tweakable levers to ${f.file}: name the CSS variables worth tuning in <meta name="canvas-levers" content="--a, --b">, defining them in :root if they are not yet.` } }) })
    if (res.ok) {
      dc.hint('Asked the agent for levers', 1800)
      dc.renderPins()
    } else dc.hint('Could not save the request', 3000)
  }

  // ── keeping it current ──
  let queued = false
  function render() {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      if (!document.body.classList.contains('panel-open')) return clearStateShown()
      const tab = dc.currentTab()
      if (tab !== 'properties') clearStateShown()
      if (tab === 'properties') {
        renderLayers()
        renderProps()
      } else if (tab === 'code') {
        renderLayers()
        renderCode()
      } else if (tab === 'tweaks') renderTweaks()
    })
  }
  ed.onChange = render
  ed.onFrameLoad = (f) => {
    if (ed.sel?.frame === f || openFrames.has(f.key) || dc.currentTab() === 'tweaks') render()
  }
  hooks.onTab = render
  hooks.onPanel = render
  hooks.onTweaks = (f) => {
    tweaksFrame = f
    render()
  }
  const onPage = hooks.onPage
  hooks.onPage = (id) => {
    onPage?.(id)
    tweaksFrame = null
    render()
  }
  dc.renderPanel = render
})()
