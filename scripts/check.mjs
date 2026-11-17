// The gate. Builds the canvas to a temporary file (keeping every line the real one has), serves
// it with edits held in memory, and works it through a real browser: one edit of each kind made
// the way a person makes it, each checked to change only its own bytes and undone back to the
// file as it was; a comment and a sticky note left and read back after a reload; Play opened and
// a link followed; the page at 390 wide. It fails on a thrown error, a console error, or any
// request off the machine. Nothing it does reaches the prototypes or the canvas on disk.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { applyEdit, parse } from './lib/html.mjs'
import { launchChromium } from './lib/browser.mjs'

const sha = (t) => crypto.createHash('sha1').update(t).digest('hex')

// The canvas asks its questions in its own dialog (#dialog), not the browser's prompt: the check
// answers it as it would a prompt, with the answer it holds or else the dialog's own default.
const answerDialogs = async (page, answer) => {
  await page.exposeFunction('__checkAnswer', answer)
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const d = document.getElementById('dialog')
      if (!d) return
      new MutationObserver(async () => {
        if (!d.open) return
        const v = await window.__checkAnswer()
        const input = document.getElementById('dialog-val')
        if (!input.hidden && v != null) input.value = v
        d.close('ok')
      }).observe(d, { attributes: true, attributeFilter: ['open'] })
    })
  })
}

/** `with` is { buildCanvas, serveCanvas }, handed in by canvas.mjs, which imports this file. */
export async function check(options, { buildCanvas, serveCanvas } = {}) {
  if (!buildCanvas) ({ buildCanvas, serveCanvas } = await import('./canvas.mjs'))
  const folder = path.resolve(options.folder)
  const real = path.resolve(options.out ?? path.join(folder, 'canvas.html'))
  const shots = options.shots ? path.resolve(options.shots) : null
  if (shots) fs.mkdirSync(shots, { recursive: true })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-canvas-check-'))
  const before = new Map(fs.readdirSync(folder).filter((f) => f.endsWith('.html')).map((f) => [f, sha(fs.readFileSync(path.join(folder, f)))]))

  const results = []
  const problems = []
  let shotN = 0
  // The canvas as it was built: its own layout and frame sizes, when no layout is given.
  let layout = options.layout
  let measure = options.measure
  if (!layout && fs.existsSync(real)) {
    const json = /<script type="application\/json" id="rc-data">([\s\S]*?)<\/script>/.exec(fs.readFileSync(real, 'utf8'))?.[1]
    const data = json ? JSON.parse(json) : null
    if (data?.pages) {
      layout = { title: data.title, pages: data.pages }
      measure = false
    }
  }
  const built = await buildCanvas({ ...options, layout, measure, folder, out: path.join(tmp, 'canvas.html'), commentsFrom: fs.existsSync(real) ? real : undefined, accept: true, quiet: true })
  const server = serveCanvas(built, { port: 0, quiet: true, memory: true })
  await new Promise((r) => server.listening ? r() : server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const { browser } = await launchChromium(folder)
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (e) => problems.push(`thrown: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !expectedErrors) problems.push(`console: ${m.text()}`) })
  let expectedErrors = 0
  await page.route('**/*', (route) => {
    const u = route.request().url()
    if (/^(data|blob|about):/.test(u) || u.startsWith(base)) return route.continue()
    problems.push(`a request off the machine: ${u}`)
    return route.abort()
  })
  let answer = null
  page.on('dialog', (d) => d.accept(answer ?? undefined))
  await answerDialogs(page, () => answer)
  // Start with nothing remembered, once: the name set below has to survive the reloads.
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('dc-check')) {
        localStorage.clear()
        sessionStorage.setItem('dc-check', '1')
      }
    } catch {}
  })

  const shot = async (name) => {
    if (shots) await page.screenshot({ path: path.join(shots, `${String(++shotN).padStart(2, '0')}-${name}.png`) })
  }
  // Each step starts from the file as it was; one that fails puts it back, so the next is not built on its wreck.
  let file = null
  let original = null
  const step = async (name, fn) => {
    for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
    try {
      const note = await fn()
      results.push({ name, ok: true, note: note === true || note == null ? '' : String(note) })
    } catch (err) {
      results.push({ name, ok: false, note: err.message.split('\n')[0] })
    }
    await shot(name.replace(/[^\w]+/g, '-').toLowerCase())
    if (file && mem(file) !== original) {
      if (results.at(-1).ok) Object.assign(results.at(-1), { ok: false, note: 'left the file changed' })
      server.canvas.outside(file, original)
      await page.reload({ waitUntil: 'load' })
      await wait(1200)
    }
  }
  const must = (cond, msg) => {
    if (!cond) throw new Error(msg)
  }
  const wait = (ms) => page.waitForTimeout(ms)
  const settle = () => page.waitForFunction(() => !document.querySelector('#hint.show') || true).then(() => wait(700))
  const mem = (file) => server.canvas.readFile(file)

  try {
    await page.goto(base, { waitUntil: 'load' })
    await wait(800)
    await page.evaluate(() => window.designCanvas.setName('canvas check'))

    // The frame the edits are made in: the first one with text in it on the first page.
    const target = await page.evaluate(async () => {
      const dc = window.designCanvas
      for (const f of dc.frames) {
        dc.view.z = Math.min(1, 1200 / f.W)
        dc.view.x = 40 - f.x * dc.view.z
        dc.view.y = 90 - f.y * dc.view.z
        dc.apply()
        for (let i = 0; i < 40 && !f.doc; i++) await new Promise((r) => setTimeout(r, 100))
        if (f.doc?.querySelector('[data-cv] h1, [data-cv] h2, [data-cv] p, [data-cv] li')) return { key: f.key, file: f.file }
      }
      return null
    })
    must(target, 'no frame with text to edit')
    file = target.file
    original = mem(file)
    await wait(500)

    /** A point on an element of the target frame, scrolled into view first. */
    const pointOf = (selector, dx = 0.3, dy = 0.5) =>
      page.evaluate(([key, selector, dx, dy]) => {
        const dc = window.designCanvas
        const f = dc.frames.find((x) => x.key === key)
        const el = typeof selector === 'number' ? f.doc.querySelector(`[data-cv="${selector}"]`) : f.doc.querySelector(selector)
        if (!el) return null
        let r = el.getBoundingClientRect()
        const top = f.y + r.top * f.s
        dc.view.y = 220 - top * dc.view.z
        dc.view.x = 120 - (f.x + r.left * f.s) * dc.view.z
        dc.apply()
        r = el.getBoundingClientRect()
        return dc.toScreen(f.x + (r.left + Math.min(r.width * dx, 60)) * f.s, f.y + (r.top + r.height * dy) * f.s)
      }, [target.key, selector, dx, dy])
    const selected = () => page.evaluate(() => {
      const ed = window.designCanvas.editor
      return ed.sel ? { n: ed.sel.els.length, cv: ed.cvOf(ed.primary()), tag: ed.primary()?.localName } : null
    })
    const pick = async (selector, opts = {}) => {
      const p = await pointOf(selector, opts.dx, opts.dy)
      must(p, `nothing matches ${selector}`)
      await page.mouse.move(p.x, p.y)
      if (opts.alt) await page.keyboard.down('Alt')
      await page.mouse.click(p.x, p.y)
      if (opts.alt) await page.keyboard.up('Alt')
      await wait(150)
      // A click lands on the innermost element there; Esc climbs to the one meant, as a person would.
      let sel = await selected()
      for (let i = 0; typeof selector === 'number' && sel && sel.cv !== selector && i < 6; i++) {
        await page.keyboard.press('Escape')
        sel = await selected()
      }
      return { p, sel }
    }
    const undoBack = async (what) => {
      await page.keyboard.press('Control+z')
      await settle()
      must(mem(file) === original, `undoing ${what} did not give back the file as it was`)
    }
    const expectOnly = (want, what) => {
      const now = mem(file)
      if (now === want) return
      let i = 0
      while (i < now.length && now[i] === want[i]) i++
      if (process.env.CANVAS_CHECK_DUMP) {
        fs.writeFileSync(path.join(process.env.CANVAS_CHECK_DUMP, `${what}-want.html`), want)
        fs.writeFileSync(path.join(process.env.CANVAS_CHECK_DUMP, `${what}-got.html`), now)
      }
      throw new Error(`${what}: the file differs from the intended edit at offset ${i}: …${JSON.stringify(now.slice(Math.max(0, i - 30), i + 50))}`)
    }
    const textSel = await page.evaluate((key) => {
      const f = window.designCanvas.frames.find((x) => x.key === key)
      const plain = (e) => Number(getComputedStyle(e).fontWeight) < 600 && !e.closest('a, button')
      // One a click selects as itself, and alone: a run inside a text block selects the block, and
      // an element with copies selects them all, which neither the text nor the style steps are about.
      const ed = window.designCanvas.editor
      const own = (e) => ed.climb(e) === e && ed.copiesOf(e).length === 1
      const el = [...f.doc.querySelectorAll('[data-cv]')].find((e) => /^(p|li|h1|h2|h3|span|td)$/.test(e.localName) && plain(e) && own(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.data.trim()) && !e.children.length && e.getBoundingClientRect().width > 4)
      return el ? Number(el.dataset.cv) : null
    }, target.key)
    must(textSel != null, 'no plain text element to edit')

    await step('Text: double-click, retype, Enter', async () => {
      const { p } = await pick(textSel)
      await page.mouse.dblclick(p.x, p.y)
      await wait(200)
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.type('Canvas check')
      await page.keyboard.press('Escape')
      await settle()
      const el = parse(original).byStart.get(textSel)
      expectOnly(original.slice(0, el.openEnd) + 'Canvas check' + original.slice(el.closeStart), 'text')
      await undoBack('the text')
    })

    await step('Text: bold and a coloured run while typing', async () => {
      const { p } = await pick(textSel)
      await page.mouse.dblclick(p.x, p.y)
      await wait(200)
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.type('one two')
      await page.keyboard.press('Shift+Home')
      await page.keyboard.press('Control+b')
      await page.evaluate(() => {
        const ed = window.designCanvas.editor
        const doc = ed.editing.frame.doc
        const s = doc.getSelection()
        const r = doc.createRange()
        const t = doc.createTreeWalker(ed.editing.el, NodeFilter.SHOW_TEXT).nextNode()
        r.setStart(t, 1)
        r.setEnd(t, 4)
        s.removeAllRanges()
        s.addRange(r)
      })
      await page.click('#float label[title="Text colour"]', { trial: true }).catch(() => {})
      await page.evaluate(() => {
        const input = document.querySelector('#float label[title="Text colour"] input')
        input.value = '#cc0000'
        input.dispatchEvent(new Event('change'))
      })
      await page.keyboard.press('Escape')
      await settle()
      const el = parse(original).byStart.get(textSel)
      const now = mem(file)
      const inner = now.slice(el.openEnd, now.length - (original.length - el.closeStart))
      must(now.startsWith(original.slice(0, el.openEnd)) && now.endsWith(original.slice(el.closeStart)), 'bytes outside the element changed')
      must(/<b>/.test(inner) && /<span style="color: (rgb\(204, 0, 0\)|#cc0000);?">/.test(inner), `no <b> and coloured span in ${inner}`)
      await undoBack('the bold run')
      return inner
    })

    await step('Style: font size through Properties', async () => {
      await pick(textSel)
      await page.evaluate(() => window.designCanvas.openPanel('properties'))
      await wait(200)
      const size = page.locator('#props input[title="Size"]')
      await size.fill('31')
      await size.press('Enter')
      await settle()
      expectOnly(applyEdit(original, { op: 'style', cv: textSel, props: { 'font-size': '31px' } }).src, 'style')
      await undoBack('the style')
    })

    // An element with a sibling after it, both in the file: for the reorder and the group.
    const pair = await page.evaluate((key) => {
      const f = window.designCanvas.frames.find((x) => x.key === key)
      const ed = window.designCanvas.editor
      const own = (e) => ed.climb(e) === e && ed.copiesOf(e).length === 1
      const el = [...f.doc.querySelectorAll('body [data-cv]')].find((e) => e.nextElementSibling?.dataset.cv && own(e) && own(e.nextElementSibling) && !['script', 'style'].includes(e.localName) && !['script', 'style'].includes(e.nextElementSibling.localName) && e.getBoundingClientRect().height > 4 && e.localName !== 'body' && getComputedStyle(e).position === 'static' && !getComputedStyle(e).display.startsWith('inline') && !getComputedStyle(e.nextElementSibling).display.startsWith('inline'))
      return el ? { a: Number(el.dataset.cv), b: Number(el.nextElementSibling.dataset.cv) } : null
    }, target.key)

    await step('Reorder: Alt+Down moves it one place', async () => {
      must(pair, 'no element with a sibling after it')
      await pick(pair.a, { alt: true })
      await page.keyboard.press('Alt+ArrowDown')
      await settle()
      expectOnly(applyEdit(original, { op: 'move', cv: pair.a, target: pair.b, where: 'after' }).src, 'reorder')
      await undoBack('the reorder')
    })

    await step('Group: Ctrl+G wraps it, Ctrl+Shift+G unwraps', async () => {
      must(pair, 'no element to group')
      await pick(pair.a, { alt: true })
      await page.keyboard.press('Control+g')
      await settle()
      expectOnly(applyEdit(original, { op: 'wrap', cv: [pair.a], tag: 'div' }).src, 'group')
      await page.keyboard.press('Control+Shift+g')
      await settle()
      must(mem(file) === original, 'ungroup did not give back the file')
      await page.keyboard.press('Control+z')
      await settle()
      await undoBack('the group')
    })

    await step('Duplicate, then delete the copy', async () => {
      await pick(textSel, { alt: true })
      await page.keyboard.press('Control+d')
      await settle()
      expectOnly(applyEdit(original, { op: 'duplicate', cv: textSel }).src, 'duplicate')
      await page.keyboard.press('Delete')
      await settle()
      must(mem(file) === original, 'deleting the copy did not give back the file')
      await page.keyboard.press('Control+z')
      await settle()
      await undoBack('the duplicate')
    })

    await step('Copy and paste', async () => {
      await pick(textSel, { alt: true })
      await page.keyboard.press('Control+c')
      await wait(300)
      await page.keyboard.press('Control+v')
      await settle()
      expectOnly(applyEdit(original, { op: 'insert', cv: textSel, where: 'after', html: (() => { const el = parse(original).byStart.get(textSel); return original.slice(el.start, el.end) })() }).src, 'paste')
      await undoBack('the paste')
    })

    await step('Resize by the right handle', async () => {
      await page.evaluate(() => window.designCanvas.setPanel(false))
      await pick(textSel, { alt: true })
      const hd = await page.evaluate(() => { const r = document.querySelector('.handle.e')?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
      must(hd, 'no handle drawn')
      await page.mouse.move(hd.x, hd.y)
      await page.mouse.down()
      await page.mouse.move(hd.x - 30, hd.y, { steps: 4 })
      await page.mouse.up()
      await settle()
      const now = mem(file)
      const el = parse(original).byStart.get(textSel)
      must(now.slice(0, el.nameEnd) === original.slice(0, el.nameEnd) && now.endsWith(original.slice(el.openEnd)), 'bytes outside the start tag changed')
      const tagNow = now.slice(el.start, parse(now).byStart.get(textSel).openEnd)
      must(/style="[^"]*\bwidth: \d+px/.test(tagNow), `no width written in ${tagNow}`)
      await undoBack('the resize')
    })

    await step('Repeated copies: one click selects them all, a change goes to a rule', async () => {
      const cls = await page.evaluate((key) => {
        const f = window.designCanvas.frames.find((x) => x.key === key)
        const ed = window.designCanvas.editor
        const el = [...f.doc.querySelectorAll('body [data-cv][class]')].find((e) => ed.copiesOf(e).length > 1 && e.getBoundingClientRect().width > 8 && e.getBoundingClientRect().height > 8)
        return el ? { cv: Number(el.dataset.cv), n: ed.copiesOf(el).length, selector: ed.copiesSelector(el) } : null
      }, target.key)
      if (!cls) return 'no repeated element in this frame; skipped'
      let { sel } = await pick(cls.cv, { dx: 0.05, dy: 0.1 })
      // Climbing to it with Esc selects that one; the "…" menu selects every copy.
      if (sel && sel.n === 1) {
        await page.click('#float [title="More"]')
        await page.click('#menu .mi:has-text("Select every copy")')
        sel = await selected()
      }
      must(sel && sel.n === cls.n, `selected ${sel?.n} of ${cls.n} copies`)
      await page.evaluate(() => window.designCanvas.editor.setStyle({ opacity: '0.9' }))
      await settle()
      expectOnly(applyEdit(original, { op: 'rule', selector: cls.selector, props: { opacity: '0.9' } }).src, 'rule')
      await undoBack('the rule')
      return `${cls.n} × ${cls.selector}`
    })

    await step('T adds a text element inside the frame', async () => {
      const p = await pointOf('body', 0.5, 0.02)
      await page.keyboard.press('t')
      await page.mouse.click(p.x, p.y)
      await settle()
      must(mem(file).length > original.length && mem(file).includes('<p>Text</p>'), 'no <p>Text</p> added')
      // The new element opens for typing.
      await page.waitForFunction(() => !!window.designCanvas.editor.editing, null, { timeout: 4000 })
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.type('Typed here')
      await page.keyboard.press('Escape')
      await settle()
      must(mem(file).includes('<p>Typed here</p>'), 'what was typed into the new element was not saved')
      await page.keyboard.press('Control+z')
      await settle()
      await undoBack('the new text')
    })

    await step('Undo is refused after a change from outside', async () => {
      await pick(textSel, { alt: true })
      await page.evaluate(() => window.designCanvas.editor.setStyle({ 'letter-spacing': '1px' }))
      await settle()
      const edited = mem(file)
      server.canvas.outside(file, `${edited}\n`)
      expectedErrors++
      await page.keyboard.press('Control+z')
      await settle()
      expectedErrors--
      must(mem(file) === `${edited}\n`, 'the undo went through over an outside change')
      server.canvas.outside(file, original)
    })

    await step('An element the prototype\'s script made can be inspected and not edited', async () => {
      const r = await page.evaluate(async (key) => {
        const dc = window.designCanvas
        const f = dc.frames.find((x) => x.key === key)
        const made = f.doc.createElement('div')
        made.textContent = 'made at run time'
        made.style.cssText = 'position:absolute;left:4px;top:4px;padding:4px;background:#fe0'
        f.doc.body.append(made)
        dc.editor.select(f, [made])
        dc.openPanel('properties')
        await new Promise((res) => setTimeout(res, 200))
        dc.editor.setStyle({ color: 'red' })
        return { note: document.querySelector('#props .note')?.textContent ?? '', hint: document.querySelector('#hint').textContent, disabled: [...document.querySelectorAll('#props input')].every((i) => i.disabled) }
      }, target.key)
      must(r.disabled && /script/.test(r.note) && /script/.test(r.hint), JSON.stringify(r))
      must(mem(file) === original, 'the file changed')
      await page.keyboard.press('Escape')
    })

    await step('Comment on an element, read back after a reload', async () => {
      const text = 'Check --> <!-- </script> "quoted" & done'
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      // At its bottom-left corner, so the pin left there does not sit where later steps click.
      const p = await pointOf(textSel, 0, 0.95)
      await page.keyboard.press('c')
      await page.mouse.click(p.x, p.y)
      await wait(200)
      await page.fill('#thread textarea', text)
      await page.click('#thread button[type=submit]')
      await wait(500)
      await page.reload({ waitUntil: 'load' })
      await wait(1200)
      const back = await page.evaluate(() => window.designCanvas.threads.at(-1))
      must(back?.text === text, `read back ${JSON.stringify(back?.text)}`)
      must(back.anchor?.path, 'the comment has no anchor')
      return back.anchor.path
    })

    await step('Comment from the floating toolbar, on the selection', async () => {
      await pick(textSel, { alt: true })
      await page.click('#float [title="Comment on it"]')
      await wait(200)
      await page.fill('#thread textarea', 'From the toolbar')
      await page.click('#thread button[type=submit]')
      await wait(500)
      const t = await page.evaluate(() => window.designCanvas.threads.at(-1))
      must(t?.text === 'From the toolbar' && t.anchor, 'no anchored comment')
      await page.keyboard.press('Escape')
    })

    await step('Sticky note: drawn, retyped, read back, deleted', async () => {
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await page.evaluate(() => { const dc = window.designCanvas; dc.view.x += 0; dc.view.y = 900 - Math.max(...dc.frames.map((f) => (f.y + f.H) * dc.view.z)) - 400; dc.apply() })
      await page.keyboard.press('n')
      await page.mouse.click(300, 700)
      await wait(500)
      await page.keyboard.type('note from the check')
      await page.mouse.click(1000, 120)
      await wait(500)
      await page.reload({ waitUntil: 'load' })
      await wait(1200)
      const it = await page.evaluate(() => window.designCanvas.items.find((i) => i.text === 'note from the check'))
      must(it, 'the note did not come back after a reload')
      await page.evaluate((id) => window.designCanvas.pickItem(id), it.id)
      await page.keyboard.press('Delete')
      await wait(400)
      must(!(await page.evaluate(() => window.designCanvas.items.some((i) => i.text === 'note from the check'))), 'the note was not deleted')
    })

    await step('Whiteboard: a section, labelled boxes, an arrow that follows, a drag box asked about and deleted', async () => {
      await page.evaluate(() => { const dc = window.designCanvas; dc.view.y = 900 - Math.max(...dc.frames.map((f) => (f.y + f.H) * dc.view.z)) - 400; dc.apply() })
      const dragOn = async (a, b) => {
        await page.mouse.move(a[0], a[1])
        await page.mouse.down()
        await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps: 4 })
        await page.mouse.move(b[0], b[1], { steps: 4 })
        await page.mouse.up()
        await wait(400)
      }
      const newest = (kind) => page.evaluate((k) => window.designCanvas.items.filter((i) => i.kind === k).at(-1) ?? null, kind)
      await page.keyboard.press('s')
      await dragOn([150, 560], [1000, 800])
      await page.keyboard.type('Plan')
      await page.mouse.click(1000, 120)
      await wait(400)
      const section = await newest('section')
      must(section?.text === 'Plan', `the section reads ${JSON.stringify(section?.text)}`)
      const boxes = []
      for (const [a, b, words] of [[[250, 620], [420, 720], 'Start'], [[700, 620], [870, 720], 'Ship']]) {
        await page.evaluate(() => window.designCanvas.setTool('rect'))
        await dragOn(a, b)
        await page.mouse.dblclick((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        await wait(200)
        await page.keyboard.press('ControlOrMeta+a')
        await page.keyboard.type(words)
        await page.mouse.click(1000, 120)
        await wait(400)
        boxes.push(await newest('rect'))
      }
      must(boxes.map((b) => b?.text).join() === 'Start,Ship', `the boxes read ${boxes.map((b) => b?.text).join()}`)
      await page.evaluate(() => window.designCanvas.setTool('arrow'))
      await dragOn([335, 670], [785, 670])
      const arrow = await newest('arrow')
      must(arrow?.from === boxes[0].id && arrow?.to === boxes[1].id, `the arrow holds ${arrow?.from} → ${arrow?.to}`)
      await page.keyboard.press('Escape')
      await dragOn([850, 640], [850, 760])
      const moved = await page.evaluate((ids) => {
        const dc = window.designCanvas
        const b = dc.items.find((i) => i.id === ids.b)
        const g = dc.geometryOf(dc.items.find((i) => i.id === ids.a))
        const endY = g.y + g.points[3]
        return { endY, top: b.y, bottom: b.y + b.h }
      }, { a: arrow.id, b: boxes[1].id })
      must(moved.endY >= moved.top - 2 && moved.endY <= moved.bottom + 2, `the arrow's end did not follow the box: ${JSON.stringify(moved)}`)
      await page.keyboard.press('Escape')
      await dragOn([120, 535], [1100, 880])
      await shot('whiteboard')
      const chosen = await page.evaluate(() => window.designCanvas.chosen)
      const ours = [section.id, ...boxes.map((b) => b.id), arrow.id]
      must(chosen && ours.every((id) => chosen.items.includes(id)), `the drag box took ${JSON.stringify(chosen?.items)}`)
      const sel = await page.evaluate(() => fetch('/api/selection').then((r) => r.json()))
      must(sel.selection?.board?.items?.length >= 4 && sel.selection.board.items.some((i) => i.text === 'Ship'), `the agent sees ${JSON.stringify(sel).slice(0, 200)}`)
      await page.click('#itembar button[title^="Ask the agent"]')
      await page.fill('#ask-text', 'what is missing between these?')
      await page.press('#ask-text', 'Enter')
      await wait(500)
      const asked = await page.evaluate(() => fetch('/api/agent').then((r) => r.json()))
      const t = asked.threads.find((x) => x.text === 'what is missing between these?')
      must(t?.box && ours.every((id) => t.items.includes(id)), `the agent's thread carries ${JSON.stringify(t ? { box: t.box, items: t.items } : null)}`)
      await page.evaluate((id) => fetch('/api/canvas-comments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: { op: 'delete', to: id, name: 'canvas check' } }) }), t.id)
      await page.click('#itembar button[title^="Delete"]')
      await wait(600)
      const left = await page.evaluate((ids) => window.designCanvas.items.filter((i) => ids.includes(i.id)).length, ours)
      must(!left, `${left} of the board objects were not deleted`)
    })

    await step('Whiteboard: a folder with no prototypes builds as an empty board', async () => {
      const empty = fs.mkdtempSync(path.join(tmp, 'board-'))
      await buildCanvas({ folder: empty, measure: false, quiet: true })
      const p4 = await browser.newPage({ viewport: { width: 1200, height: 800 } })
      const thrown = []
      p4.on('pageerror', (e) => thrown.push(e.message))
      try {
        await p4.goto(new URL(`file:///${path.join(empty, 'canvas.html').replace(/\\/g, '/')}`).href, { waitUntil: 'load' })
        await p4.waitForTimeout(600)
        const r = await p4.evaluate(() => ({ frames: window.designCanvas.frames.length, page: document.querySelector('#page-name').textContent }))
        must(!thrown.length, `thrown: ${thrown.join('; ')}`)
        must(r.frames === 0 && r.page === 'Board', JSON.stringify(r))
      } finally {
        await p4.close().catch(() => {})
      }
    })

    await step('Play: open it and follow a link', async () => {
      const f = await page.evaluate(() => {
        const dc = window.designCanvas
        const all = dc.allFrames
        const withLink = all.find((x) => x.meta.play && /href="[^"#:]+\.html/.test(dc.data.files[x.file]))
        const any = withLink ?? all.find((x) => x.meta.play) ?? all[0]
        dc.openPlay(any, 'fill')
        return { key: any.key, link: !!withLink }
      })
      await wait(800)
      const title0 = await page.textContent('#play-title')
      if (f.link) {
        await page.frameLocator('#play iframe').locator('a[href$=".html"], a[href*=".html#"]').first().click()
        await wait(800)
        const title1 = await page.textContent('#play-title')
        must(title1 !== title0, `the link did not move on from ${title0}`)
      }
      await page.click('#play [data-width="390"]')
      await wait(300)
      await shot('play-390')
      await page.keyboard.press('Escape')
      return f.link ? 'followed a link' : 'no link between prototypes; opened only'
    })

    await step('At 390 wide nothing scrolls sideways', async () => {
      await page.setViewportSize({ width: 390, height: 800 })
      await wait(500)
      const w = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))
      must(w <= 390, `the page is ${w} wide`)
      await page.setViewportSize({ width: 1440, height: 900 })
    })

    await step('Ctrl+wheel: one notch moves the zoom shown by 2 points (2% of itself above 100%)', async () => {
      await page.mouse.move(700, 450)
      const z0 = await page.evaluate(() => window.designCanvas.view.z)
      await page.keyboard.down('Control')
      await page.mouse.wheel(0, -100)
      await page.keyboard.up('Control')
      await wait(150)
      const z1 = await page.evaluate(() => window.designCanvas.view.z)
      const want = z0 < 1 ? z0 + 0.02 : z0 * 1.02
      must(Math.abs(z1 - want) < 0.001, `one notch went from ${(z0 * 100).toFixed(1)}% to ${(z1 * 100).toFixed(1)}%`)
    })

    // ── opened from disk: no server, the page writes into the folder it is given ──
    // A plain static host stands in for the disk (the browser's own folder needs a secure origin),
    // and the browser's own private folder, holding a copy of the prototypes and the canvas, stands
    // in for the folder the person picks: a test cannot click the system's folder dialog.
    const fixed = { 'canvas.html': fs.readFileSync(path.join(tmp, 'canvas.html'), 'utf8') }
    for (const f of Object.keys(built.payload.files)) fixed[f] = fs.readFileSync(path.join(folder, f), 'utf8')
    const disk = http.createServer((req, res) => {
      const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1))
      if (!fixed[name]) {
        res.writeHead(404, { 'content-type': 'application/json' })
        return res.end('{}')
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(fixed[name])
    })
    await new Promise((r) => disk.listen(0, '127.0.0.1', r))
    const diskUrl = `http://127.0.0.1:${disk.address().port}/canvas.html?local`
    const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    p2.on('pageerror', (e) => problems.push(`from disk, thrown: ${e.message} (${(e.stack || '').split(/\n/).slice(1, 3).join(' ').trim()})`))
    let p2answer = 'canvas check'
    p2.on('dialog', (d) => d.accept(p2answer))
    await answerDialogs(p2, () => p2answer)
    // The page asks a static host for comments before editing is on; those are answered 404 and
    // are not errors. Anything after editing is on must never reach the network.
    let editingOn = false
    p2.on('request', (r) => {
      if (editingOn && /\/api\//.test(r.url())) problems.push(`from disk, a request left the page: ${r.url()}`)
    })
    const opfs = (name) => p2.evaluate(async (name) => (await (await (await navigator.storage.getDirectory()).getFileHandle(name)).getFile()).text(), name)
    try {
      await p2.addInitScript((files) => {
        window.showDirectoryPicker = async () => {
          const root = await navigator.storage.getDirectory()
          for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true })
          for (const [name, text] of Object.entries(files)) {
            const w = await (await root.getFileHandle(name, { create: true })).createWritable()
            await w.write(text)
            await w.close()
          }
          return root
        }
      }, fixed)
      await p2.goto(diskUrl, { waitUntil: 'load' })
      await p2.waitForTimeout(1000)
      await p2.evaluate(() => { indexedDB.deleteDatabase('design-canvas'); window.designCanvas.setName('canvas check') })

      await step('From disk, editing off: nothing is shown that cannot work', async () => {
        const seen = await p2.evaluate((key) => {
          const shown = (sel) => [...document.querySelectorAll(sel)].some((e) => e.offsetParent !== null)
          const dc = window.designCanvas
          const f = dc.frames.find((x) => x.key === key)
          dc.editor.select(f, [f.doc.body.firstElementChild])
          dc.openPanel('properties')
          return new Promise((r) => setTimeout(() => {
            document.querySelector('#page-switch').click()
            const menu = document.querySelector('#menu').innerText
            dc.closeMenu()
            r({
              tools: ['text', 'artboard', 'note', 'pencil'].filter((t) => shown(`#toolbar [data-tool="${t}"]`)).concat(shown('#toolbar .split') ? ['shapes'] : []),
              // Comment, More, and the Edit button that turns editing on all work with editing off.
              float: [...document.querySelectorAll('#float .fbtn:not(.cta)')].map((b) => b.title).filter((t) => !['Comment on it', 'More'].includes(t)),
              floatEdit: !!document.querySelector('#float .fbtn.cta'),
              inputs: document.querySelectorAll('#props input, #props select').length,
              newPage: /New page/.test(menu),
            })
          }, 300))
        }, target.key)
        must(!seen.tools.length, `tools shown: ${seen.tools.join(', ')}`)
        must(!seen.float.length, `floating toolbar shows ${seen.float.join(', ')}`)
        must(seen.floatEdit, 'the floating toolbar has no Edit button to turn editing on')
        must(!seen.inputs, `${seen.inputs} controls in Properties`)
        must(!seen.newPage, 'New page is offered')
      })

      await step('From disk: Edit here, in the note on a selection, is clickable and turns editing on', async () => {
        await p2.evaluate((key) => {
          const dc = window.designCanvas
          const f = dc.frames.find((x) => x.key === key)
          dc.editor.select(f, [f.doc.querySelector(`[data-cv="${f.doc.querySelector('[data-cv]') ? '' : ''}"]`) ?? f.doc.body.firstElementChild])
          dc.openPanel('properties')
        }, target.key)
        await p2.waitForTimeout(300)
        const button = p2.locator('#props .note button.start-edit')
        must(await button.count(), 'no Edit here button in the note')
        must(!(await button.isDisabled()), 'Edit here is greyed out')
        await button.click({ timeout: 3000 })
        await p2.waitForFunction(() => /Editing/.test(document.querySelector('#canvas-mode').textContent), null, { timeout: 8000 })
        editingOn = true
      })

      await step('From disk: an edit is written into the prototype byte for byte, and into canvas.html', async () => {
        await p2.waitForFunction(([key, cv]) => !!window.designCanvas.frames.find((x) => x.key === key)?.doc?.querySelector(`[data-cv="${cv}"]`), [target.key, textSel], { timeout: 8000 })
        await p2.evaluate(([key, cv]) => {
          const dc = window.designCanvas
          const f = dc.frames.find((x) => x.key === key)
          dc.editor.select(f, [f.doc.querySelector(`[data-cv="${cv}"]`)])
          dc.editor.setStyle({ color: '#cc0000' })
        }, [target.key, textSel])
        await p2.waitForTimeout(1200)
        must((await opfs(file)) === applyEdit(original, { op: 'style', cv: textSel, props: { color: '#cc0000' } }).src, `${file} is not exactly the intended edit`)
        const canvasNow = await opfs('canvas.html')
        must(/^<!-- edit \{"op":"style"/m.test(canvasNow), 'no edit line in canvas.html')
        must(canvasNow.includes('color: #cc0000'), 'the inlined copy in canvas.html was not refreshed')
      })

      await step('From disk: a comment is written into canvas.html, and undo gives the file back', async () => {
        await p2.keyboard.press('Escape')
        await p2.keyboard.press('Escape')
        await p2.keyboard.press('c')
        await p2.mouse.click(700, 450)
        await p2.waitForTimeout(300)
        await p2.fill('#thread textarea', 'left with no server --> ok')
        await p2.click('#thread button[type=submit]')
        await p2.waitForTimeout(800)
        must((await opfs('canvas.html')).includes('left with no server -\\u002d> ok'), 'the comment line is not in canvas.html')
        await p2.keyboard.press('Escape')
        await p2.keyboard.press('c')
        await p2.mouse.click(760, 480)
        await p2.waitForTimeout(300)
        must(!/\bnull\b/.test(await p2.textContent('#thread')), 'a new comment box shows "null"')
        await p2.keyboard.press('Escape')
        await p2.keyboard.press('Control+z')
        await p2.waitForTimeout(1200)
        must((await opfs(file)) === original, `undo did not give ${file} back`)
      })

      await step('From disk: an artboard is made in the folder and drawn without a reload', async () => {
        await p2.evaluate(() => { window.__stillHere = true })
        p2answer = 'new board'
        await p2.keyboard.press('Escape')
        await p2.keyboard.press('a')
        await p2.mouse.move(200, 780)
        await p2.mouse.down()
        await p2.mouse.move(420, 860, { steps: 4 })
        await p2.mouse.up()
        await p2.waitForTimeout(1500)
        must(await p2.evaluate(() => window.__stillHere === true), 'the page reloaded')
        must(await p2.evaluate(() => /Editing/.test(document.querySelector('#canvas-mode').textContent)), 'editing turned off')
        const seen = await p2.evaluate(() => ({ hint: document.querySelector('#hint').textContent, loose: (window.designCanvas.data.loose || []).map((l) => l.file), all: window.designCanvas.allFrames.map((f) => `${f.file}@${f.page}`), page: window.designCanvas.page }))
        must(await p2.evaluate(() => window.designCanvas.frames.some((f) => f.file === 'new-board.html')), `no frame for the new file: ${JSON.stringify(seen)}`)
        must(/<main /.test(await opfs('new-board.html')), 'new-board.html was not written')
      })
    } finally {
      await p2.close().catch(() => {})
    }

    await step('A browser that cannot save shows a banner, and ✕ closes it', async () => {
      const p3 = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      try {
        await p3.addInitScript(() => { delete window.showDirectoryPicker })
        await p3.goto(diskUrl, { waitUntil: 'load' })
        await p3.waitForTimeout(600)
        must(/can only view/.test((await p3.textContent('#banner').catch(() => '')) ?? ''), 'no banner')
        await p3.click('#banner .tool')
        must(!(await p3.locator('#banner').count()), 'the banner did not close')
      } finally {
        await p3.close().catch(() => {})
        disk.close()
      }
    })

    await step('The prototypes and the canvas on disk are untouched', async () => {
      for (const [f, s] of before) must(sha(fs.readFileSync(path.join(folder, f))) === s, `${f} changed on disk`)
      must(mem(file) === original, `${file} held in memory is not back to how it was`)
    })
  } finally {
    await browser.close().catch(() => {})
    server.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }

  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.note ? ` (${r.note})` : ''}`)
  for (const p of [...new Set(problems)]) console.log(`✗ ${p}`)
  const failed = results.filter((r) => !r.ok).length + problems.length
  console.log(failed ? `check failed: ${failed} problem${failed === 1 ? '' : 's'}` : `check passed: ${results.length} steps on ${path.basename(folder)}`)
  return failed ? 1 : 0
}
