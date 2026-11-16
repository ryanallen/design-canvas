// Every edit op changes only its own bytes, on a small fixture and on a real prototype.
// node --test scripts/lib
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyEdit, canvasRules, parse, tag, untag } from './html.mjs'

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
