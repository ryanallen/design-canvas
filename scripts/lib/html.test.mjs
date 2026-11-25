// Every edit op changes only its own bytes, on a small fixture and on a real prototype.
// node --test scripts/lib
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyEdit, canvasRules, lockedFor, parse, tag, untag } from './html.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = `<!doctype html>
<html>
<head>
<title>t</title>
<style>p { color: red }</style>
</head>
<body>
<main id="m">
  <h1 class="big">Hello <b>there</b></h1>
  <p>One
  <p style="margin: 0">Two</p>
  <ul><li>a<li>b</ul>
  <div class="card"><span>x</span></div>
  <div class="card"><span>y</span></div>
</main>
<script>if (a < b) document.body.append('<p>')</script>
</body>
</html>
`
const real = fs.readFileSync(path.join(here, '..', '..', 'examples', 'plain', 'home.html'), 'utf8')

const find = (src, pred) => [...parse(src).byStart.values()].find(pred)
const byTag = (src, t, n = 0) => [...parse(src).byStart.values()].filter((e) => e.tag === t)[n]
const cls = (el) => el.attrs.find((a) => a.name === 'class')?.value ?? ''

/** The one span that differs between two texts: what is the same before and after it is untouched. */
function changed(a, b) {
  let s = 0
  while (s < a.length && s < b.length && a[s] === b[s]) s++
  let e = 0
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++
  return { start: s, removed: a.slice(s, a.length - e), added: b.slice(s, b.length - e) }
}

for (const [name, src] of [['fixture', fixture], ['home.html', real]]) {
  test(`${name}: tag and untag round trip, every element closed`, () => {
    assert.equal(untag(tag(src)), src)
    for (const el of parse(src).byStart.values()) assert.ok(el.end >= el.start, `${el.tag} at ${el.start} has an end`)
  })

  test(`${name}: style sets and merges only the style attribute`, () => {
    const h1 = name === 'fixture' ? byTag(src, 'h1') : find(src, (e) => cls(e) === 'btn')
    const out = applyEdit(src, { op: 'style', cv: h1.start, props: { color: '#0E6E6E' } }).src
    const d = changed(src, out)
    assert.equal(d.removed, '')
    assert.match(d.added, /^ ?(style=")?.*color: #0E6E6E/)
    assert.ok(d.start >= h1.start && d.start <= h1.openEnd)
    const again = applyEdit(out, { op: 'style', cv: h1.start, props: { color: '' } }).src
    assert.equal(again, src)
  })

  test(`${name}: inner replaces only the element's content`, () => {
    const h1 = byTag(src, 'h1')
    const out = applyEdit(src, { op: 'inner', cv: h1.start, html: 'New <i>words</i>' }).src
    assert.equal(out, src.slice(0, h1.openEnd) + 'New <i>words</i>' + src.slice(h1.closeStart))
  })

  test(`${name}: attr adds, changes and removes one attribute`, () => {
    const h1 = byTag(src, 'h1')
    const out = applyEdit(src, { op: 'attr', cv: h1.start, name: 'data-name', value: 'Lead' }).src
    assert.equal(out, src.slice(0, h1.nameEnd) + ' data-name="Lead"' + src.slice(h1.nameEnd))
    assert.equal(applyEdit(out, { op: 'attr', cv: h1.start, name: 'data-name', value: null }).src, src)
  })

  test(`${name}: delete removes the element and its own line`, () => {
    const h1 = byTag(src, 'h1')
    const out = applyEdit(src, { op: 'delete', cv: h1.start }).src
    const gone = src.length - out.length
    let s = h1.start
    while (s > 0 && src.slice(0, s) + src.slice(s + gone) !== out && /\s/.test(src[s - 1])) s--
    assert.equal(src.slice(0, s) + src.slice(s + gone), out)
    assert.ok(s <= h1.start && s + gone >= h1.end)
    assert.match(src.slice(s, h1.start) + src.slice(h1.end, s + gone), /^\s*$/)
  })

  test(`${name}: duplicate adds one copy after it`, () => {
    const h1 = byTag(src, 'h1')
    const r = applyEdit(src, { op: 'duplicate', cv: h1.start })
    assert.ok(r.src.startsWith(src.slice(0, h1.end)) && r.src.endsWith(src.slice(h1.end)))
    assert.equal(r.src.slice(h1.end, r.src.length - (src.length - h1.end)).trim(), src.slice(h1.start, h1.end))
    assert.equal(parse(r.src).byStart.get(r.select).tag, 'h1')
  })

  test(`${name}: move puts it before a sibling and nothing else changes`, () => {
    const h1 = byTag(src, 'h1')
    const next = h1.parent.children[h1.parent.children.indexOf(h1) + 1]
    const r = applyEdit(src, { op: 'move', cv: next.start, target: h1.start, where: 'before' })
    assert.equal(r.src.length, src.length)
    assert.equal([...r.src].sort().join(''), [...src].sort().join(''))
    assert.equal(parse(r.src).byStart.get(r.select).tag, next.tag)
    const back = applyEdit(r.src, { op: 'move', cv: r.select, target: r.select + (next.end - next.start) + (h1.start - h1.start), where: 'after' })
    assert.ok(back.src.length === src.length)
  })

  test(`${name}: wrap groups siblings and unwrap gives back the file`, () => {
    const h1 = byTag(src, 'h1')
    const r = applyEdit(src, { op: 'wrap', cv: [h1.start], tag: 'div' })
    assert.equal(r.src, src.slice(0, h1.start) + '<div>' + src.slice(h1.start, h1.end) + '</div>' + src.slice(h1.end))
    assert.equal(applyEdit(r.src, { op: 'unwrap', cv: r.select }).src, src)
  })

  test(`${name}: insert adds markup at one place`, () => {
    const h1 = byTag(src, 'h1')
    const r = applyEdit(src, { op: 'insert', cv: h1.start, where: 'after', html: '<p>New</p>' })
    assert.equal(r.src, src.slice(0, h1.end) + '<p>New</p>' + src.slice(h1.end))
  })

  test(`${name}: outer replaces the element whole`, () => {
    const h1 = byTag(src, 'h1')
    const r = applyEdit(src, { op: 'outer', cv: h1.start, html: '<h2 data-cv="9">Swap</h2>' })
    assert.equal(r.src, src.slice(0, h1.start) + '<h2>Swap</h2>' + src.slice(h1.end))
  })

  test(`${name}: rule writes one stylesheet of the canvas's own, and removing the last property removes the rule`, () => {
    const r = applyEdit(src, { op: 'rule', selector: '.card', props: { 'border-radius': '20px' } })
    const head = src.indexOf('</head>')
    assert.equal(r.src, src.slice(0, head) + '<style data-canvas>\n.card { border-radius: 20px !important }\n</style>\n' + src.slice(head))
    assert.deepEqual(canvasRules(r.src), [{ selector: '.card', props: { 'border-radius': '20px !important' } }])
    const r2 = applyEdit(r.src, { op: 'rule', selector: '.card', props: { 'border-radius': '' } })
    assert.equal(canvasRules(r2.src).length, 0)
  })
}

test('a lever declared in the prototype\'s :root changes where it is declared; an undeclared one goes to the canvas sheet', () => {
  const src = '<html><head><style>\n  :root { --gap: 24px; --tint: rgba(1, 2, 3, 0.5) }\n  .a { gap: var(--gap) }\n</style></head><body><p>x</p></body></html>'
  const r = applyEdit(src, { op: 'rule', selector: ':root', props: { '--gap': '32px', '--tint': 'rgba(4, 5, 6, 0.5)' } })
  assert.equal(r.src, src.replace('24px', '32px').replace('rgba(1, 2, 3, 0.5)', 'rgba(4, 5, 6, 0.5)'))
  const r2 = applyEdit(r.src, { op: 'rule', selector: ':root', props: { '--new': '1' } })
  assert.deepEqual(canvasRules(r2.src), [{ selector: ':root', props: { '--new': '1 !important' } }])
  const r3 = applyEdit(r2.src, { op: 'rule', selector: ':root', props: { '--gap': '8px', '--new': '2' } })
  assert.match(r3.src, /:root \{ --gap: 8px;/)
  assert.deepEqual(canvasRules(r3.src), [{ selector: ':root', props: { '--new': '2 !important' } }])
  const over = applyEdit(src.replace('</head>', '<style data-canvas>\n:root { --gap: 40px !important }\n</style>\n</head>'), { op: 'rule', selector: ':root', props: { '--gap': '12px' } })
  assert.match(over.src, /--gap: 12px;/)
  assert.equal(canvasRules(over.src).length, 0, 'the old override is dropped so the declared value shows')
})

test('a style edit carrying keyframes writes them once, by name, in the head; the selection still lands on the element', () => {
  const src = '<html><head><title>t</title></head><body><p class="a">x</p><p>y</p></body></html>'
  const p = parse(src)
  const el = [...p.byStart.values()].find((e) => e.tag === 'p')
  const r = applyEdit(src, { op: 'style', cv: el.start, props: { animation: 'dc-rise 400ms ease-out both' }, keyframes: { 'dc-rise': 'from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: none }' } })
  assert.match(r.src, /<style data-canvas-keyframes>\n@keyframes dc-rise \{ from \{ opacity: 0; transform: translateY\(16px\) \} to \{ opacity: 1; transform: none \} \}\n<\/style>\n<\/head>/)
  assert.equal(parse(r.src).byStart.get(r.select)?.tag, 'p')
  assert.match(r.src.slice(r.select), /^<p [^>]*style="animation: dc-rise 400ms ease-out both"/)
  const again = applyEdit(r.src, { op: 'style', cv: r.select, props: { animation: 'dc-rise 250ms ease-out both' }, keyframes: { 'dc-rise': 'from { opacity: 0 } to { opacity: 1 }' } })
  assert.equal(again.src.match(/@keyframes dc-rise/g).length, 1, 'replaced, not repeated')
  assert.throws(() => applyEdit(src, { op: 'style', cv: el.start, props: {}, keyframes: { x: '</style><script>' } }))
})

test('styles sets several elements\' own styles in one edit; a locked one refuses it whole', () => {
  const src = '<html><head></head><body><ul><li class="r">a</li><li class="r">b</li><li class="r" data-locked>c</li></ul></body></html>'
  const lis = [...parse(src).byStart.values()].filter((e) => e.tag === 'li')
  const r = applyEdit(src, { op: 'styles', items: lis.slice(0, 2).map((li, i) => ({ cv: li.start, props: { 'animation-delay': `${i * 60}ms` } })) })
  assert.equal(r.src, src.replace('<li class="r">a', '<li style="animation-delay: 0ms" class="r">a').replace('<li class="r">b', '<li style="animation-delay: 60ms" class="r">b'))
  assert.equal(parse(r.src).byStart.get(r.select)?.tag, 'li')
  assert.ok(lockedFor(src, { op: 'styles', items: lis.map((li) => ({ cv: li.start, props: { color: 'red' } })) }))
  assert.equal(lockedFor(src, { op: 'styles', items: lis.slice(0, 2).map((li) => ({ cv: li.start, props: { color: 'red' } })) }), null)
})

test('styles also sets attributes, in the same edit; data-locked through it is the owner\'s alone', () => {
  const src = '<html><head></head><body><div class="c" data-component="Card"><b style="color: red">x</b></div></body></html>'
  const els = [...parse(src).byStart.values()]
  const div = els.find((e) => e.tag === 'div')
  const b = els.find((e) => e.tag === 'b')
  const r = applyEdit(src, { op: 'styles', items: [{ cv: div.start, props: {}, attrs: { 'data-variant': 'Dark' } }, { cv: b.start, props: { color: 'white' } }] })
  assert.match(r.src, /<div [^>]*data-variant="Dark"[^>]*><b style="color: white">x<\/b><\/div>/)
  assert.ok(lockedFor(src, { op: 'styles', items: [{ cv: div.start, attrs: { 'data-locked': '' } }] }))
  assert.equal(lockedFor(src, { op: 'styles', items: [{ cv: div.start, attrs: { 'data-locked': '' } }] }, { owner: true }), null)
})

test('fixture: implied closings and raw text', () => {
  const ps = [...parse(fixture).byStart.values()].filter((e) => e.tag === 'p')
  assert.equal(ps.length, 2, 'the <p> inside the script is text')
  assert.equal(fixture.slice(ps[0].openEnd, ps[0].closeStart).trim(), 'One')
  const lis = [...parse(fixture).byStart.values()].filter((e) => e.tag === 'li')
  assert.equal(lis.length, 2)
  assert.equal(fixture.slice(lis[0].openEnd, lis[0].closeStart), 'a')
})

test('duplicate then delete gives back the file, on a shared line and with CRLF', () => {
  for (const src of ['<div>\n  <p>a</p><p>b</p>\n</div>\n', '<div>\r\n  <p>a</p>\r\n  <p>b</p>\r\n</div>\r\n']) {
    const p = byTag(src, 'p')
    const r = applyEdit(src, { op: 'duplicate', cv: p.start })
    assert.equal(applyEdit(r.src, { op: 'delete', cv: r.select }).src, src)
  }
})

test('an edit at an offset that is not an element is refused', () => {
  assert.throws(() => applyEdit(fixture, { op: 'style', cv: 3, props: { color: 'red' } }), /no element at 3/)
})

test('a locked element and what holds it are refused; around it, editing goes on', () => {
  const src = '<main><section data-locked><h1>Mine</h1></section><p>Yours</p></main>'
  const { byStart } = parse(src)
  const at = (tagName) => [...byStart.values()].find((e) => e.tag === tagName).start
  assert.match(lockedFor(src, { op: 'inner', cv: at('h1'), html: 'x' }), /locked/)
  assert.match(lockedFor(src, { op: 'delete', cv: at('section') }), /locked/)
  assert.match(lockedFor(src, { op: 'inner', cv: at('main'), html: 'x' }), /locked/)
  assert.match(lockedFor(src, { op: 'move', cv: at('p'), target: at('h1'), where: 'after' }), /locked/)
  assert.match(lockedFor(src, { op: 'attr', cv: at('p'), name: 'data-locked', value: '' }), /owner/)
  assert.equal(lockedFor(src, { op: 'inner', cv: at('p'), html: 'Changed' }), null)
  assert.equal(lockedFor(src, { op: 'style', cv: at('main'), props: { color: 'red' } }), null)
  assert.equal(lockedFor(src, { op: 'move', cv: at('p'), target: at('section'), where: 'before' }), null)
})

const comp = `<body>
<div data-component="Card" class="card"><h3>Tides</h3><p class="m">High</p></div>
<div data-component="Card" class="card"><h3>Swell</h3><p class="m">Big</p></div>
<div class="card"><h3>Wind</h3><p class="m">Calm</p></div>
<div data-component="Card" class="card"><h3>Rain</h3><p class="m" data-locked>Wet</p></div>
</body>`

test('a style made inside one copy of a component is made in every copy, and nowhere else', () => {
  const second = byTag(comp, 'p', 1)
  const r = applyEdit(comp, { op: 'style', cv: second.start, props: { color: 'red' } })
  const ps = [...parse(r.src).byStart.values()].filter((e) => e.tag === 'p')
  assert.deepEqual(ps.map((p) => p.attrs.find((a) => a.name === 'style')?.value ?? ''), ['color: red', 'color: red', '', ''])
  assert.equal(r.linked, 1, 'the locked copy is left as it is')
  assert.equal(parse(r.src).byStart.get(r.select)?.tag, 'p')
  assert.equal(r.src.slice(r.select).startsWith('<p style="color: red" class="m">Big'), true, 'the one clicked stays selected')
})

test('text typed into a copy, its id and only: true stay that copy\'s own', () => {
  const h = byTag(comp, 'h3', 0)
  assert.equal(applyEdit(comp, { op: 'inner', cv: h.start, html: 'Tide times' }).src.match(/Tide times/g).length, 1)
  assert.equal(applyEdit(comp, { op: 'attr', cv: h.start, name: 'id', value: 'x' }).src.match(/id="x"/g).length, 1)
  assert.equal(applyEdit(comp, { op: 'style', cv: h.start, props: { color: 'red' }, only: true }).src.match(/color: red/g).length, 1)
})

test('something put into, duplicated or removed from one copy happens in every copy', () => {
  const card = byTag(comp, 'div', 0)
  const ins = applyEdit(comp, { op: 'insert', cv: card.start, where: 'inside', html: '<button>Go</button>' })
  assert.equal(ins.src.match(/<button>Go<\/button>/g).length, 3)
  const h = byTag(comp, 'h3', 1)
  assert.equal(applyEdit(comp, { op: 'delete', cv: h.start }).src.match(/<h3>/g).length, 1, 'only the plain card keeps its heading')
  assert.equal(applyEdit(comp, { op: 'duplicate', cv: h.start }).src.match(/<h3>/g).length, 7)
})

test('duplicating a whole copy makes one more copy, linked to the rest', () => {
  const card = byTag(comp, 'div', 1)
  const r = applyEdit(comp, { op: 'duplicate', cv: card.start })
  assert.equal(r.src.match(/data-component="Card"/g).length, 4)
  const p = byTag(r.src, 'p', 0)
  assert.equal(applyEdit(r.src, { op: 'style', cv: p.start, props: { opacity: '0.5' } }).linked, 2)
})


test('replaceText changes words in the text only: not tags, attributes, scripts, styles, comments or locked parts', () => {
  const src = '<html><head><title>Tides</title><style>.tides { color: red }</style></head><body>\n<h1 class="tides" title="Tides">Tides &amp; swell</h1>\n<!-- Tides -->\n<p>Check the TIDES daily.</p>\n<p data-locked>Tides locked</p>\n<script>const tides = "Tides"</script>\n</body></html>'
  const r = applyEdit(src, { op: 'replaceText', find: 'tides', with: 'Waves' })
  assert.equal(r.count, 2)
  assert.equal(r.src, src.replace('>Tides &amp; swell', '>Waves &amp; swell').replace('the TIDES daily', 'the Waves daily'))
  const amp = applyEdit(src, { op: 'replaceText', find: 'Tides & swell', with: 'a < b' })
  assert.equal(amp.count, 1)
  assert.ok(amp.src.includes('>a &lt; b</h1>'))
  assert.throws(() => applyEdit(src, { op: 'replaceText', find: '' }), /nothing to find/)
})

test('a duplicate gets ids of its own', () => {
  const src = '<body>\n<section id="hero"><h1 id="title">Hi</h1></section>\n<p id="hero-2">x</p>\n</body>'
  const el = find(src, (e) => e.tag === 'section')
  const r = applyEdit(src, { op: 'duplicate', cv: el.start })
  assert.ok(r.src.includes('<section id="hero-3"><h1 id="title-2">Hi</h1></section>'), r.src)
  assert.equal((r.src.match(/id="hero"/g) ?? []).length, 1)
})

test('pasted markup keeps its ids unless the page has them', () => {
  const src = '<body>\n<main id="m"><p id="a">x</p></main>\n</body>'
  const el = find(src, (e) => e.tag === 'main')
  const r = applyEdit(src, { op: 'insert', cv: el.start, where: 'inside', html: '<p id="a">y</p><p id="b">z</p>' })
  assert.ok(r.src.includes('<p id="a-2">y</p><p id="b">z</p>'), r.src)
})

test('a variant takes styles from its own variant only, and parts added from every copy', () => {
  const src = '<body>\n<a data-component="Btn" class="b"><span>Go</span></a>\n<a data-component="Btn" class="b"><span>Stop</span></a>\n<a data-component="Btn" data-variant="Quiet" class="b"><span>Later</span></a>\n</body>'
  const first = find(src, (e) => e.tag === 'span')
  const styled = applyEdit(src, { op: 'style', cv: first.start, props: { color: 'red' } })
  assert.equal(styled.linked, 1)
  assert.equal((styled.src.match(/color: red/g) ?? []).length, 2)
  assert.ok(styled.src.includes('<span>Later</span>'), 'the Quiet variant keeps its look')
  const quiet = [...parse(src).byStart.values()].filter((e) => e.tag === 'span')[2]
  assert.equal(applyEdit(src, { op: 'style', cv: quiet.start, props: { opacity: '0.6' } }).linked, 0)
  const root = find(src, (e) => e.tag === 'a')
  assert.equal((applyEdit(src, { op: 'insert', cv: root.start, where: 'inside', html: '<i>›</i>' }).src.match(/<i>›<\/i>/g) ?? []).length, 3)
})

test('decl changes a declaration of the prototype\'s own rule where it is written, adds one, takes one out', () => {
  const src = '<html><head><style>\n  /* cards { color: x } */\n  .cards>.card h3 { color: #222; font-size: 14px }\n  @media (min-width: 9px) { .x { color: red; } }\n  .x { color: blue }\n</style></head><body><p>x</p></body></html>'
  const a = applyEdit(src, { op: 'decl', selector: '.cards > .card h3', prop: 'color', value: '#0a6' })
  assert.equal(a.src, src.replace('color: #222', 'color: #0a6'))
  const b = applyEdit(src, { op: 'decl', selector: '.cards > .card h3', prop: 'font-weight', value: '600' })
  assert.equal(b.src, src.replace('font-size: 14px }', 'font-size: 14px; font-weight: 600; }'))
  const c = applyEdit(src, { op: 'decl', selector: '.cards > .card h3', prop: 'color', value: '' })
  assert.equal(c.src, src.replace(' color: #222;', ''))
  const d = applyEdit(src, { op: 'decl', selector: '.x', nth: 1, prop: 'color', value: 'green' })
  assert.equal(d.src, src.replace('color: blue', 'color: green'))
  const e = applyEdit(src, { op: 'decl', selector: '.x', prop: 'color', value: 'green' })
  assert.equal(e.src, src.replace('color: red;', 'color: green;'))
  assert.throws(() => applyEdit(src, { op: 'decl', selector: '.nope', prop: 'color', value: 'red' }), /no rule .nope/)
  assert.throws(() => applyEdit(src, { op: 'decl', selector: '.x', prop: 'color: red; x', value: 'red' }), /not a property/)
})
