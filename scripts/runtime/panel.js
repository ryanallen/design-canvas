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
            h('span', { class: 'ln' }, n.text))
          rows.push(row)
          if (kids.length && open.has(c)) walk(c, d + 1)
        }
      }
      walk(f.doc.body, 1)
    }
    host.append(h('div', { class: 'lhead' }, 'Layers'), h('div', { class: 'lbody' }, rows.length ? rows : h('div', { class: 'empty' }, 'Nothing on this page.')))
    host.querySelector('.lrow.on:not(.lframe)')?.scrollIntoView({ block: 'nearest' })
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
  const color = (value, onPick, onRemove) => {
    const hex = ed.rgbHex(value)
    const c = h('input', { type: 'color', value: hex })
    const t = input(value === 'rgba(0, 0, 0, 0)' ? '' : hex.toUpperCase(), (v) => onPick(v))
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
    dc.openMenu(anchor, [
      { note: 'In this prototype' },
      ...own.map((f, i) => row(ownNames[i], f)),
      '-',
      { note: `On this computer (${installed.length})` },
      ...installed.filter((f) => !ownNames.includes(f)).map((f) => row(f, quote(f))),
      '-',
      { note: 'Generic' },
      ...GENERIC.filter((f) => !ownNames.includes(f)).map((f) => row(f, f)),
    ])
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
  function renderProps() {
    const host = $('#props')
    host.replaceChildren()
    const el = ed.primary()
    if (!el) return host.append(h('div', { class: 'empty' }, 'Nothing selected. Click any element in the design to edit it here.'))
    const c = cs(el)
    const S = (p) => ed.shared(p)
    const set = (props) => ed.setStyle(props)
    const parent = el.parentElement
    const pc = parent ? cs(parent) : null
    const parentFlex = pc?.display.includes('flex')
    const parentRow = parentFlex && !pc.flexDirection.startsWith('column')
    const can = ed.sel.els.every(ed.editable)
    if (!can) host.append(h('div', { class: 'note' }, ed.notEditable(el), !dc.serve && dc.startLocal ? h('button', { type: 'button', class: 'btn start-edit', onclick: () => dc.startLocal() }, 'Edit here') : null))
    host.append(h('div', { class: 'ptitle' }, ed.nameOf(el).text, ed.sel.els.length > 1 ? h('small', {}, ` · ${ed.sel.els.length} copies${can ? `: changes go to ${ed.copiesSelector(el)}` : ''}`) : null))
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
    const sizeMode = (dim) => {
      const own = el.style.getPropertyValue(dim)
      if (/fit-content|max-content|auto/.test(own)) return 'hug'
      if (own === '100%' || (dim === 'width' ? parentRow : parentFlex && !parentRow) && Number(c.flexGrow) > 0) return 'fill'
      if (/px$/.test(own) || (dim === 'width' ? c.display === 'block' && false : false)) return 'fixed'
      return /px$/.test(own) ? 'fixed' : 'hug'
    }
    const setMode = (dim, mode) => {
      const r = el.getBoundingClientRect()
      const along = dim === 'width' ? parentRow : parentFlex && !parentRow
      if (mode === 'hug') set({ [dim]: 'fit-content', ...(along ? { flex: '' } : {}) })
      else if (mode === 'fixed') set({ [dim]: `${Math.round(dim === 'width' ? r.width : r.height)}px`, ...(along ? { flex: '' } : {}) })
      else if (along) set({ flex: '1 1 0', [dim]: '' })
      else set({ [dim]: '100%' })
    }
    const dimRow = (dim, label) => field(label, input(num(c.getPropertyValue(dim)), (v) => set({ [dim]: px(v) }), { class: 'n' }), seg([['hug', 'Hug'], ['fixed', 'Fixed'], ['fill', 'Fill']], sizeMode(dim), (m) => setMode(dim, m)))
    host.append(section('Size', ['min-width', 'max-width', 'min-height', 'max-height', 'aspect-ratio', 'overflow', 'margin', 'z-index', 'inset'],
      dimRow('width', 'Width'),
      dimRow('height', 'Height'),
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
    if (grid) layout.push(field('Columns', input(c.gridTemplateColumns.split(' ').length > 6 ? c.gridTemplateColumns.slice(0, 40) : c.gridTemplateColumns, (v) => set({ 'grid-template-columns': /^\d+$/.test(v.trim()) ? `repeat(${v.trim()}, 1fr)` : v }))))
    if (flex || grid) layout.push(field('Gap', input(num(c.rowGap) === num(c.columnGap) ? num(c.rowGap) : `${c.rowGap} ${c.columnGap}`, (v) => set({ gap: v.split(/\s+/).map(px).join(' ') }), { class: 'n' })))
    const pads = ['top', 'right', 'bottom', 'left'].map((s) => num(c.getPropertyValue(`padding-${s}`)))
    const uniform = pads.every((p) => p === pads[0])
    layout.push(paddingSides || !uniform
      ? field('Padding', ...['top', 'right', 'bottom', 'left'].map((s, i) => input(pads[i], (v) => set({ [`padding-${s}`]: px(v) }), { class: 'n s', title: s })), h('button', { type: 'button', class: 'mini', title: 'One value', onclick: () => { paddingSides = false; renderProps() } }, '▢'))
      : field('Padding', input(pads[0], (v) => set({ padding: px(v) }), { class: 'n' }), h('button', { type: 'button', class: 'mini', title: 'Each side', onclick: () => { paddingSides = true; renderProps() } }, '⊞')))
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
        field('Color', color(S('color'), (v) => set({ color: v }))),
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
      field('Fill', color(bg, (v) => set({ 'background-color': v }), bg !== 'rgba(0, 0, 0, 0)' ? () => set({ 'background-color': '', background: '' }) : null)),
      field('Opacity', slider, h('span', { class: 'val' }, `${op}%`)),
      radiusCorners || !sameR
        ? field('Radius', ...['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((k, i) => input(radii[i], (v) => set({ [`border-${k}-radius`]: px(v) }), { class: 'n s', title: k })), h('button', { type: 'button', class: 'mini', onclick: () => { radiusCorners = false; renderProps() } }, '▢'))
        : field('Radius', input(radii[0], (v) => set({ 'border-radius': px(v) }), { class: 'n' }), h('button', { type: 'button', class: 'mini', title: 'Each corner', onclick: () => { radiusCorners = true; renderProps() } }, '⊞')),
      field('Border', seg([['none', 'None'], ['solid', 'Solid'], ['dashed', 'Dash'], ['dotted', 'Dot']], c.borderTopStyle, (v) => set(v === 'none' ? { border: 'none' } : { 'border-style': v, 'border-width': num(c.borderTopWidth) > 0 ? c.borderTopWidth : '1px', 'border-color': c.borderTopStyle === 'none' ? '#d1d5db' : c.borderTopColor }))),
      c.borderTopStyle !== 'none' ? field('Width · Color', input(num(c.borderTopWidth), (v) => set({ 'border-width': px(v) }), { class: 'n' }), color(c.borderTopColor, (v) => set({ 'border-color': v }))) : null,
      field('Shadow', input(c.boxShadow === 'none' ? '' : c.boxShadow, (v) => set({ 'box-shadow': v || 'none' }), { placeholder: '0 2px 8px rgba(0,0,0,.15)' }))))
  }

  // ── code ──
  function rulesFor(el) {
    const out = []
    for (const sheet of el.ownerDocument.styleSheets) {
      let rules
      try { rules = sheet.cssRules } catch { continue }
      const walk = (list) => {
        for (const r of list) {
          if (r.cssRules && !r.selectorText) {
            if (!r.media || win(el).matchMedia(r.media.mediaText).matches) walk(r.cssRules)
            continue
          }
          if (!r.selectorText || !r.style) continue
          try { if (!el.matches(r.selectorText)) continue } catch { continue }
          out.push({ selector: r.selectorText, decls: [...r.style].map((p) => [p, r.style.getPropertyValue(p) + (r.style.getPropertyPriority(p) ? ' !important' : '')]) })
        }
      }
      walk(rules)
    }
    return out
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
      for (const r of rulesFor(el).reverse()) host.append(h('div', { class: 'chead' }, `From ${r.selector}`), ...r.decls.map(([p, v]) => h('div', { class: 'decl ro' }, h('span', { class: 'p' }, p), h('span', { class: 'v' }, v))))
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
    for (const r of rulesFor(el).reverse()) {
      host.append(h('div', { class: 'chead' }, `From ${r.selector}`),
        ...r.decls.map(([p, v]) => h('div', { class: 'decl ro' }, h('span', { class: 'p' }, p), h('span', { class: 'v' }, v), h('button', { type: 'button', class: 'mini', title: 'Set it on the element itself', onclick: () => ed.setStyle({ [p]: v.replace(/\s*!important$/, '') }) }, '+'))))
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
    const go = () => {
      if (p.value.trim() && v.value.trim()) onAdd(p.value.trim(), v.value.trim())
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
    for (const name of levers) {
      const value = cs(root).getPropertyValue(name).trim()
      if (!dc.serve) {
        host.append(field(name, h('span', { class: 'val' }, value)))
        continue
      }
      const commit = (v) => ed.send({ op: 'rule', selector: ':root', props: { [name]: v } }, { file: f.file, key: f.key })
      const live = (v) => root.style.setProperty(name, v)
      let control
      if (/^(#|rgb|hsl)/i.test(value)) {
        const c = h('input', { type: 'color', value: ed.rgbHex(value) })
        c.addEventListener('input', () => live(c.value))
        c.addEventListener('change', () => commit(c.value))
        control = c
      } else if (/^-?[\d.]+(px|rem|em|%)?$/.test(value)) {
        const unit = /[a-z%]+$/.exec(value)?.[0] ?? ''
        const n = parseFloat(value)
        const r = h('input', { type: 'range', min: 0, max: Math.max(100, Math.ceil(n * 4)), step: unit === 'rem' || unit === 'em' ? 0.05 : 1, value: n })
        const out = h('span', { class: 'val' }, value)
        r.addEventListener('input', () => { live(`${r.value}${unit}`); out.textContent = `${r.value}${unit}` })
        r.addEventListener('change', () => commit(`${r.value}${unit}`))
        control = h('div', { class: 'pc' }, r, out)
      } else control = input(value, commit)
      host.append(field(name, control))
    }
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
      if (!document.body.classList.contains('panel-open')) return
      const tab = dc.currentTab()
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
