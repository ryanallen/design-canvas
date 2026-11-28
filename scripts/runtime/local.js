// Editing with no server. A canvas opened from disk in Chrome or Edge asks once for its own
// folder (the File System Access API), then answers every /api/ call the page makes itself: an
// edit is applied with the same engine the server uses (canvasHtml, inlined from lib/html.mjs)
// and written into the prototype's file, and every comment, edit and board line is written into
// canvas.html, with the prototype's inlined copy refreshed so the file opened later shows it.
// The folder is remembered (IndexedDB), so after the first time Edit only asks to allow it again.
//
// A canvas built with "play" in its layout and opened from a website edits with no folder: the
// same answers, from the prototypes inlined in the page, and every change kept in that browser
// (localStorage) for that visitor alone.
;(() => {
  const dc = window.designCanvas
  const data = dc.data
  const mode = document.getElementById('canvas-mode')
  const supported = typeof window.showDirectoryPicker === 'function'
  const play = dc.web && !!data.play && !data.serve
  if (!play && location.protocol !== 'file:' && !new URLSearchParams(location.search).has('local')) return
  if (data.serve) return

  // ── remembering the folder ──
  const idb = () =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open('design-canvas', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('folders')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  const remember = async (handle) => {
    try {
      const db = await idb()
      db.transaction('folders', 'readwrite').objectStore('folders').put(handle, data.key)
    } catch {}
  }
  const recall = async () => {
    try {
      const db = await idb()
      return await new Promise((resolve) => {
        const req = db.transaction('folders').objectStore('folders').get(data.key)
        req.onsuccess = () => resolve(req.result ?? null)
        req.onerror = () => resolve(null)
      })
    } catch {
      return null
    }
  }

  // ── the folder's files ──
  let dir = null
  let canvasName = 'canvas.html'
  let canvasText = ''
  const raw = new Map()
  const seen = new Map()
  let lines = []
  const undo = []
  const redo = []
  let selection = null
  const fileHandle = async (rel, create = false) => {
    const parts = rel.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.')
    let d = dir
    for (const p of parts.slice(0, -1)) {
      if (p === '..') throw new Error(`${rel} is outside the folder`)
      // A file made in a folder not there yet (a first picture into images/) makes the folder.
      d = await d.getDirectoryHandle(p, { create })
    }
    return d.getFileHandle(parts[parts.length - 1], { create })
  }
  const readText = async (rel) => (await (await fileHandle(rel)).getFile()).text()

  // ── playing: what this visitor changed, kept in their browser ──
  const keepKey = `dc:${data.key}:play`
  let builtLines = 0
  const builtFiles = new Set()
  const edited = new Set()
  let full = false
  const keep = () => {
    const made = (data.loose ?? []).filter((l) => !builtFiles.has(l.file))
    const kept = {
      lines: lines.slice(builtLines),
      files: Object.fromEntries([...edited].map((f) => [f, raw.get(f)])),
      loose: made,
      meta: Object.fromEntries(made.map((l) => [l.file, data.meta[l.file]])),
    }
    try {
      localStorage.setItem(keepKey, JSON.stringify(kept))
    } catch {
      if (!full) dc.hint('This browser is out of room for saved changes. New ones will last until you close the page.', 5000)
      full = true
    }
  }
  const kept = () => {
    try {
      return JSON.parse(localStorage.getItem(keepKey))
    } catch {
      return null
    }
  }

  // One write at a time, in the order asked.
  let queue = Promise.resolve()
  const write = (rel, text) => {
    if (play) {
      edited.add(rel)
      keep()
      return Promise.resolve()
    }
    queue = queue.then(async () => {
      const w = await (await fileHandle(rel, true)).createWritable()
      await w.write(text)
      await w.close()
      const f = await (await fileHandle(rel)).getFile()
      seen.set(rel, f.lastModified)
    })
    return queue
  }

  // A prototype made self-contained, as build does: its stylesheets shared as assets, its local
  // scripts and pictures inlined, so it draws in a frame that has no address of its own.
  const local = (ref) => ref && !/^(data:|https?:|\/\/|#|mailto:|about:|javascript:|blob:)/i.test(ref)
  const mime = { css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', woff2: 'font/woff2', woff: 'font/woff' }
  const dataUrl = async (rel) => {
    const file = await (await fileHandle(rel)).getFile()
    const bytes = new Uint8Array(await file.arrayBuffer())
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return `data:${mime[rel.split('.').pop().toLowerCase()] ?? 'application/octet-stream'};base64,${btoa(bin)}`
  }
  const replaceAsync = async (text, re, fn) => {
    const parts = []
    let at = 0
    for (const m of text.matchAll(re)) {
      parts.push(text.slice(at, m.index), await fn(...m))
      at = m.index + m[0].length
    }
    return parts.join('') + text.slice(at)
  }
  async function inline(html) {
    html = await replaceAsync(html, /<link\b[^>]*>/gi, async (tag) => {
      const href = /\bhref="([^"]+)"/i.exec(tag)?.[1]
      if (!href || !/stylesheet/i.test(/\brel="([^"]+)"/i.exec(tag)?.[1] ?? '')) return tag
      if (!local(href)) return ''
      const name = decodeURIComponent(href.split(/[?#]/)[0]).replace(/^\.\//, '')
      if (!data.assets[name]) {
        try {
          data.assets[name] = { type: 'text/css', text: await readText(name) }
        } catch {
          return tag
        }
      }
      return tag.replace(href, `__RC_ASSET__(${name})`)
    })
    html = await replaceAsync(html, /<script\b([^>]*)\ssrc="([^"]+)"([^>]*)><\/script>/gi, async (tag, a, src, b) => {
      if (!local(src)) return ''
      try {
        return `<script${a}${b}>${(await readText(src)).replace(/<\/script/gi, '<\\/script')}</script>`
      } catch {
        return tag
      }
    })
    html = await replaceAsync(html, /(<(?:img|source|video|audio)\b[^>]*?\s(?:src|poster)=")([^"]+)(")/gi, async (all, pre, ref, post) => {
      if (!local(ref)) return all
      try {
        return `${pre}${await dataUrl(decodeURIComponent(ref.split(/[?#]/)[0]))}${post}`
      } catch {
        return all
      }
    })
    return html
  }
  const served = async (file) => (play ? canvasHtml.tag(raw.get(file)) : inline(canvasHtml.tag(raw.get(file))))

  // ── canvas.html: its payload and its lines, rewritten after every change ──
  const sha = async (text) => {
    const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
  }
  const OPEN = '<script type="application/json" id="rc-data">'
  const LINE = /^<!-- (?:comment|edit|board) \{.*\} -->\r?\n/gm
  async function writeCanvas(changed = []) {
    let text = canvasText
    if (changed.length) {
      const a = text.indexOf(OPEN) + OPEN.length
      const b = text.indexOf('</script>', a)
      const payload = JSON.parse(text.slice(a, b))
      for (const file of changed) payload.files[file] = play ? raw.get(file) : await inline(raw.get(file))
      payload.assets = data.assets
      payload.meta = data.meta
      payload.loose = data.loose
      const json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
      text = text.slice(0, a) + json + text.slice(b)
    }
    text = text.replace(LINE, '')
    const end = text.lastIndexOf('</body>')
    text = `${text.slice(0, end)}${lines.map((l) => `${l}\n`).join('')}${text.slice(end)}`
    canvasText = text
    if (play) keep()
    else await write(canvasName, text)
  }
  const lineOf = (event, kind) => `<!-- ${kind} ${JSON.stringify(event).replace(/--/g, '-\\u002d')} -->`

  // The change an edit made, in words, for its edit line.
  const describe = (src, cv) => {
    const el = cv == null ? null : canvasHtml.parse(src).byStart.get(Number(cv))
    if (!el) return ''
    const cls = el.attrs.find((x) => x.name === 'class')?.value.trim().split(/\s+/).slice(0, 2).join('.')
    const name = el.attrs.find((x) => x.name === 'data-name')?.value
    return name ? `"${name}"` : `<${el.tag}${cls ? `.${cls}` : ''}>`
  }
  const props = (p) => Object.entries(p).map(([k, v]) => `${k}: ${v === '' || v == null ? '(removed)' : v}`).join('; ')
  const summarize = (src, edit) => {
    const what = edit.cv == null ? '' : describe(src, [edit.cv].flat()[0])
    switch (edit.op) {
      case 'styles': return `${(edit.items ?? []).length} elements: ${(edit.items ?? []).map((it) => `${describe(src, it.cv)} ${props(it.props)}`).join(' · ')}`
      case 'style': return `${what} ${props(edit.props)}`
      case 'decl': return `${edit.selector} ${edit.prop}: ${edit.value === '' || edit.value == null ? '(removed)' : edit.value}`
      case 'rule': return `${edit.selector} ${props(edit.props)}`
      case 'inner': return `${what} now reads "${edit.html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 140)}"`
      case 'attr': return `${what} ${edit.name}=${JSON.stringify(edit.value ?? null)}`
      case 'move': return `${what} moved ${edit.where} ${describe(src, edit.target)}`
      case 'insert': return `new ${edit.html.slice(0, 80)} ${edit.where ?? 'inside'} ${what}`
      case 'replaceText': return `replaced ${JSON.stringify(String(edit.find).slice(0, 80))} with ${JSON.stringify(String(edit.with ?? '').slice(0, 80))} in the text`
      default: return `${edit.op} ${what}`
    }
  }

  // ── the /api/ answers ──
  const answer = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const nameOf = (n) => String(n || 'someone').slice(0, 80)
  async function handle(url, init) {
    const u = new URL(url, location.href)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
    const post = (init?.method ?? 'GET').toUpperCase() === 'POST'
    const known = (file) => raw.has(file)
    const locks = () => foldBoard(parseLines(lines.join('\n'), 'board')).locked
    switch (u.pathname.replace(/^.*?(\/api\/)/, '$1')) {
      case '/api/canvas-comments': {
        if (!post) return answer(200, { events: parseEvents(lines.join('\n')), viewer: null })
        const event = makeEvent(body.event)
        // A visitor answers the owner's comments but does not delete or resolve them.
        if (play && (event.op === 'delete' || event.op === 'resolve' || event.op === 'place')) {
          const own = parseEvents(lines.slice(0, builtLines).join('\n')).flatMap((e) => [e.id].filter(Boolean))
          if (own.includes(event.to)) return answer(403, { error: 'That comment belongs to the owner' })
        }
        lines.push(lineOf(event, 'comment'))
        await writeCanvas()
        return answer(200, { event })
      }
      case '/api/board': {
        if (!post) {
          const events = parseLines(lines.join('\n'), 'board')
          return answer(200, { events, board: foldBoard(events) })
        }
        const event = makeBoardEvent(body.event)
        const held = locks()
        if (play && event.op === 'lock') return answer(403, { error: 'Only the owner can lock and unlock things.' })
        if (held.includes(event.op === 'move' ? event.key : event.id) && ['item', 'remove', 'move'].includes(event.op)) return answer(403, { error: 'That is locked' })
        lines.push(lineOf(event, 'board'))
        await writeCanvas()
        return answer(200, { event })
      }
      case '/api/file': {
        const file = u.searchParams.get('f')
        if (!known(file)) return answer(404, { error: `${file} is not on this canvas` })
        return answer(200, { html: await served(file) })
      }
      case '/api/source': {
        const file = u.searchParams.get('f')
        if (!known(file)) return answer(404, { error: `${file} is not on this canvas` })
        const src = raw.get(file)
        const el = canvasHtml.parse(src).byStart.get(Number(u.searchParams.get('cv')))
        return answer(200, { html: el ? src.slice(el.start, el.end) : null })
      }
      case '/api/edit': {
        const { file, edit, name } = body
        if (!known(file)) return answer(404, { error: `${file} is not on this canvas` })
        const before = raw.get(file)
        if (locks().some((k) => k === file || k.startsWith(`${file}#`))) return answer(403, { error: 'This artboard is locked' })
        const refused = canvasHtml.lockedFor(before, edit, { owner: !play })
        if (refused) return answer(403, { error: refused })
        const result = canvasHtml.applyEdit(before, edit)
        if (result.src === before) return answer(200, { select: result.select, html: await served(file), same: true })
        raw.set(file, result.src)
        await write(file, result.src)
        undo.push({ file, before, after: result.src })
        // The last 200 steps, as the server keeps: each holds the whole file twice.
        if (undo.length > 200) undo.splice(0, undo.length - 200)
        redo.length = 0
        lines.push(lineOf({ op: edit.op, id: randomId('e'), at: new Date().toISOString(), name: nameOf(name), file, summary: summarize(before, edit).slice(0, 600), sha: await sha(result.src) }, 'edit'))
        await writeCanvas([file])
        return answer(200, { select: result.select, linked: result.linked ?? 0, count: result.count, html: await served(file) })
      }
      case '/api/undo':
      case '/api/redo': {
        const back = u.pathname.endsWith('/undo')
        const step = (back ? undo : redo).pop()
        if (!step) return answer(200, { none: true })
        const now = play ? raw.get(step.file) : await readText(step.file)
        if (now !== (back ? step.after : step.before)) {
          ;(back ? undo : redo).push(step)
          return answer(409, { error: `${step.file} has changed somewhere else since then, so nothing was undone.` })
        }
        const want = back ? step.before : step.after
        raw.set(step.file, want)
        await write(step.file, want)
        ;(back ? redo : undo).push(step)
        lines.push(lineOf({ op: back ? 'undo' : 'redo', id: randomId('e'), at: new Date().toISOString(), name: nameOf(body.name), file: step.file, summary: back ? 'undid the last edit' : 'redid an edit', sha: await sha(want) }, 'edit'))
        await writeCanvas([step.file])
        return answer(200, { file: step.file, html: await served(step.file) })
      }
      case '/api/selection':
        if (post) {
          selection = body.selection ?? null
          return answer(200, { ok: true })
        }
        return answer(200, { selection })
      case '/api/agent':
        return answer(200, { threads: foldEvents(parseEvents(lines.join('\n'))).filter((t) => t.agent && !t.resolved) })
      case '/api/history':
        return answer(200, { edits: parseLines(lines.join('\n'), 'edit') })
      case '/api/canvas':
        return new Response(canvasText, { headers: { 'content-type': 'text/html' } })
      case '/api/refresh':
        return answer(409, { error: 'Rebuilding lays the prototypes out again, which needs node. Run node scripts/canvas.mjs build <folder>.' })
      case '/api/image': {
        // A picture dropped or pasted, saved into the folder's images/, as the server does: known kinds by their
        // bytes, the same picture again the file already there, another of the same name numbered.
        if (play) return answer(409, { error: 'A picture is saved into the folder, so this needs the folder. Download the canvas and open it with Edit here.' })
        const bytes = new Uint8Array(await init.body.arrayBuffer())
        if (bytes.length > 15_000_000) return answer(413, { error: 'the picture is larger than 15 MB' })
        const str = (a, b) => String.fromCharCode(...bytes.subarray(a, b))
        const starts = (...b) => b.every((v, i) => bytes[i] === v)
        const ext = starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) ? 'png' : starts(0xff, 0xd8, 0xff) ? 'jpg' : str(0, 4) === 'GIF8' ? 'gif' : str(0, 4) === 'RIFF' && str(8, 12) === 'WEBP' ? 'webp' : str(4, 8) === 'ftyp' && /avi[fs]/.test(str(8, 12)) ? 'avif' : null
        if (!ext) return answer(415, { error: 'a PNG, JPEG, GIF, WebP or AVIF picture' })
        const base = (u.searchParams.get('name') || 'image').replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image'
        for (let n = 1; ; n++) {
          const src = `images/${base}${n > 1 ? `-${n}` : ''}.${ext}`
          let have = null
          try {
            have = new Uint8Array(await (await (await fileHandle(src)).getFile()).arrayBuffer())
          } catch {}
          if (!have) {
            await write(src, bytes)
            return answer(200, { src, saved: true })
          }
          if (have.length === bytes.length && have.every((v, i) => v === bytes[i])) return answer(200, { src, saved: false })
        }
      }
      case '/api/artboard': {
        // Copies of prototypes on the board (Ctrl+D on screens): each file copied whole to <name>-copy.html.
        if (Array.isArray(body.copies)) {
          const files = []
          const events = []
          for (const c of body.copies.slice(0, 20)) {
            const from = String(c?.from ?? '')
            if (!known(from)) return answer(404, { error: `${from} is not on this canvas` })
            const base = from.replace(/\.html$/, '').replace(/^.*\//, '').replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 54)
            const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : ''
            const taken = async (f) => {
              if (raw.has(f)) return true
              if (play) return false
              try {
                await fileHandle(f)
                return true
              } catch {
                return false
              }
            }
            let file = `${dir}${base}-copy.html`
            for (let n = 2; await taken(file); n++) file = `${dir}${base}-copy-${n}.html`
            const html = raw.get(from)
            raw.set(file, html)
            await write(file, html)
            data.files[file] = await served(file)
            data.meta[file] = { ...(data.meta[from] ?? { levers: [], fluid: false, play: false }) }
            ;(data.loose ??= []).push({ file, hash: '', label: file.replace(/\.html$/, ''), w: Math.round(Number(c.w) || 1440), h: Math.round(Number(c.h) || 900) })
            const event = makeBoardEvent({ op: 'move', key: file, x: Number(c.x) || 0, y: Number(c.y) || 0, page: body.page, name: body.by })
            lines.push(lineOf(event, 'board'))
            files.push(file)
            events.push(event)
          }
          await writeCanvas(files)
          return answer(200, { files, events })
        }
        const base = String(body.name ?? '').trim().toLowerCase().replace(/\.html$/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
        if (!base) return answer(400, { error: 'the artboard needs a name' })
        const file = `${base}.html`
        if (/^canvas(-[a-z0-9-]+)?\.html$/.test(file)) return answer(400, { error: `${file} is the name of a canvas` })
        if (raw.has(file)) return answer(409, { error: `${file} is already on this canvas` })
        if (!play) {
          try {
            await fileHandle(file)
            return answer(409, { error: `${file} is already in the folder` })
          } catch {}
        }
        const w = Math.max(240, Math.min(3840, Math.round(Number(body.w) || 1440)))
        const title = String(body.name).trim().slice(0, 120).replace(/</g, '&lt;')
        const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${title}</title>\n${w === 1440 ? '' : `<meta name="canvas-width" content="${w}">\n`}<style>\n  body { margin: 0; font-family: system-ui, sans-serif; }\n</style>\n</head>\n<body>\n<main style="min-height: ${Math.max(240, Math.round(Number(body.h) || 900))}px">\n</main>\n</body>\n</html>\n`
        raw.set(file, html)
        await write(file, html)
        data.files[file] = await served(file)
        data.meta[file] = { levers: [], fluid: false, play: false }
        ;(data.loose ??= []).push({ file, hash: '', label: base, w, h: Math.max(480, Math.round(Number(body.h) || 900)) })
        const event = makeBoardEvent({ op: 'move', key: file, x: Number(body.x) || 0, y: Number(body.y) || 0, page: body.page, name: body.by })
        lines.push(lineOf(event, 'board'))
        await writeCanvas([file])
        return answer(200, { file, event })
      }
      default:
        return answer(404, { error: 'not found' })
    }
  }
  const realFetch = window.fetch.bind(window)
  let on = false
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    if (on && /^(\/|\.\/|[^:]*\/)?api\//.test(url.replace(location.origin, ''))) {
      return handle(url, init).catch((err) => answer(400, { error: err.message }))
    }
    return realFetch(input, init)
  }

  /** Edit with the folder given: read every prototype and the canvas, then answer /api/ from them. */
  async function useFolder(handle) {
    dir = handle
    canvasName = decodeURIComponent(location.pathname.split('/').pop() || '') || 'canvas.html'
    if (!/\.html$/i.test(canvasName)) canvasName = 'canvas.html'
    try {
      canvasText = await readText(canvasName)
    } catch {
      throw new Error(`There's no ${canvasName} in that folder. Pick the folder this canvas is in.`)
    }
    for (const file of Object.keys(data.files)) {
      try {
        raw.set(file, await readText(file))
        seen.set(file, (await (await fileHandle(file)).getFile()).lastModified)
      } catch {
        throw new Error(`${file} isn't in that folder. Pick the folder this canvas is in.`)
      }
    }
    lines = storedLines(canvasText)
    for (const file of raw.keys()) data.files[file] = await served(file)
    on = true
    dc.enableLocal(dir.name || "this folder")
    // A change made outside the canvas (an agent, a build script) redraws its frames.
    setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      for (const file of raw.keys()) {
        try {
          const f = await (await fileHandle(file)).getFile()
          if (f.lastModified === seen.get(file)) continue
          seen.set(file, f.lastModified)
          const text = await f.text()
          if (text === raw.get(file)) continue
          raw.set(file, text)
          dc.fileChanged(file)
        } catch {}
      }
    }, 2000)
  }
  /** Edit from the page itself, as a visitor to the site it is on: nothing to pick, kept in this browser. */
  async function usePage() {
    canvasName = decodeURIComponent(location.pathname.split('/').pop() || '') || 'index.html'
    try {
      canvasText = await (await realFetch(location.pathname, { cache: 'no-store' })).text()
    } catch {
      canvasText = `<!doctype html>\n${document.documentElement.outerHTML}`
    }
    for (const file of Object.keys(data.files)) {
      raw.set(file, data.files[file])
      builtFiles.add(file)
    }
    lines = storedLines(document.documentElement.outerHTML)
    builtLines = lines.length
    const before = kept()
    if (before) {
      for (const l of before.loose ?? []) {
        if (builtFiles.has(l.file) || typeof before.files?.[l.file] !== 'string') continue
        ;(data.loose ??= []).push(l)
        data.meta[l.file] = before.meta?.[l.file] ?? { levers: [], fluid: false, play: false }
      }
      for (const [file, text] of Object.entries(before.files ?? {})) {
        if (typeof text !== 'string') continue
        raw.set(file, text)
        edited.add(file)
      }
      for (const l of before.lines ?? []) if (typeof l === 'string') lines.push(l)
    }
    for (const file of raw.keys()) data.files[file] = canvasHtml.tag(raw.get(file))
    on = true
    dc.enableLocal('here', 'Edit, draw and comment: everything is kept in this browser, for you alone', true)
    dc.refreshBoard()
  }
  if (play) {
    // A visitor takes back everything they changed: the canvas as it was published.
    dc.startOver = async () => {
      if (!(await dc.sure('Drop every change you made here and see the canvas as it was published?', 'Start over', true))) return
      try { localStorage.removeItem(keepKey) } catch {}
      location.reload()
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(usePage))
    else setTimeout(usePage)
    return
  }

  async function start() {
    try {
      let handle = await recall()
      if (handle && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') handle = null
      if (!handle) handle = await window.showDirectoryPicker({ id: 'design-canvas', mode: 'readwrite', startIn: 'desktop' })
      await useFolder(handle)
      await remember(handle)
      dc.hint(`Editing ${handle.name}. Changes are saved into its files.`, 2600)
    } catch (err) {
      if (err?.name !== 'AbortError') dc.hint(err.message, 5000)
    }
  }

  // The mode chip becomes the Edit button.
  const button = document.createElement('button')
  button.type = 'button'
  button.id = 'canvas-mode'
  button.className = 'mode edit'
  button.textContent = supported ? 'Viewing · Edit' : 'Viewing'
  button.title = supported ? 'Edit and comment here: pick the folder this canvas is in, once' : 'Editing from disk needs Chrome or Edge; anywhere else, serve it with node scripts/canvas.mjs serve <folder>'
  button.disabled = !supported
  button.addEventListener('click', () => !on && start())
  mode.replaceWith(button)
  dc.showEmpty?.()
  dc.useFolder = useFolder
  if (supported) dc.startLocal = () => !on && start()

  // A browser that cannot save says so up front, once per visit, and can be closed.
  if (!supported) {
    const banner = document.createElement('div')
    banner.id = 'banner'
    banner.setAttribute('role', 'status')
    const text = document.createElement('span')
    text.textContent = 'This browser can only view this canvas: it cannot save edits or comments to your files. Open canvas.html in Chrome or Edge to edit.'
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'tool'
    close.title = 'Close'
    close.setAttribute('aria-label', 'Close')
    close.textContent = '✕'
    close.addEventListener('click', () => {
      banner.remove()
      document.body.classList.remove('has-banner')
    })
    banner.append(text, close)
    document.body.append(banner)
    document.body.classList.add('has-banner')
  }
})()
