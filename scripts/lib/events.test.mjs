// The lines a canvas keeps: written, read back, checked and folded.
// node --test "scripts/lib/*.test.mjs"
import test from 'node:test'
import assert from 'node:assert/strict'
import { eventLine, foldBoard, foldEvents, insertEvent, makeBoardEvent, makeEvent, parseEvents, parseLines, storedLines } from './events.mjs'

const now = new Date('2026-11-14T10:00:00.000Z')
let n = 0
const newId = (p) => `${p}-${String(++n).padStart(6, '0')}`
const make = (input) => makeEvent(input, { now, newId })
const board = (input) => makeBoardEvent(input, { now, newId })

test('a line holding --> and <!-- stays one HTML comment and reads back the same', () => {
  const e = make({ op: 'add', name: 'Ann', text: 'a --> b <!-- c -- d', frame: 'v1.html', x: 1, y: 2 })
  const line = eventLine(e)
  assert.equal((line.match(/-->/g) || []).length, 1)
  assert.ok(line.endsWith(' -->'))
  assert.deepEqual(parseEvents(line), [e])
})

test('a page carries its place, and the fold keeps it with its name', () => {
  const a = board({ op: 'page', id: 'p2', title: 'Ideas' })
  const b = board({ op: 'page', id: 'p2', order: 0 })
  assert.equal(b.order, 0)
  assert.deepEqual(foldBoard([a, b]).pages, [{ id: 'p2', title: 'Ideas', order: 0 }])
  assert.throws(() => board({ op: 'page', id: 'p2', order: 'first' }))
})

test('a comment off the prototypes keeps its page, and the board object it is on with its offset', () => {
  const on = makeEvent({ op: 'add', name: 'A', text: 'Say what dragging does', x: 300, y: 200, page: 'p2', item: 'b-abc123', dx: 12.4, dy: 8 })
  assert.deepEqual([on.page, on.item, on.dx, on.dy], ['p2', 'b-abc123', 12, 8])
  const t = foldEvents([on])[0]
  assert.deepEqual([t.page, t.item, t.dx, t.dy], ['p2', 'b-abc123', 12, 8])
  // On a prototype, the frame says where it is: no page or object is kept.
  const framed = makeEvent({ op: 'add', name: 'A', text: 'Hi', frame: 'home.html', x: 1, y: 2, page: 'p2', item: 'b-abc123' })
  assert.equal(framed.page, undefined)
  assert.equal(framed.item, undefined)
  assert.throws(() => makeEvent({ op: 'add', name: 'A', text: 'Hi', x: 1, y: 2, item: 'b-1', dx: 'x' }), /dx is not a number/)
})

test('a screen joins a group by its move line, keeps it through later moves, and leaves it on an empty one', () => {
  const at = (e) => makeBoardEvent({ op: 'move', key: 'home.html', ...e })
  const folded = (events) => foldBoard(events).moved['home.html']
  assert.equal(folded([at({ x: 1, y: 2, group: 'g-abc1234' })]).group, 'g-abc1234')
  assert.equal(folded([at({ x: 1, y: 2, group: 'g-abc1234' }), at({ x: 5, y: 6 })]).group, 'g-abc1234')
  assert.equal(folded([at({ x: 1, y: 2, group: 'g-abc1234' }), at({ x: 5, y: 6, group: '' })]).group, undefined)
  assert.throws(() => at({ x: 1, y: 2, group: 'not a group' }), /group is not an id/)
})

test('a bad line is skipped, not fatal', () => {
  const good = eventLine(make({ op: 'add', name: 'A', text: 'ok', frame: null, x: 0, y: 0 }))
  const html = `<!-- comment {not json} -->\n${good}\n<!-- comment {"no":"op"} -->`
  assert.equal(parseEvents(html).length, 1)
})

test('lines are read by kind, and storedLines keeps every kind as written', () => {
  const html = ['<p>x</p>', eventLine(make({ op: 'add', name: 'A', text: 't', frame: null, x: 0, y: 0 })), eventLine({ op: 'style', id: 'e-1', file: 'a.html' }, 'edit'), eventLine(board({ op: 'name', title: 'T' }), 'board'), '<!-- other {"op":"x"} -->'].join('\n')
  assert.equal(parseLines(html, 'edit').length, 1)
  assert.equal(parseLines(html, 'board').length, 1)
  assert.equal(storedLines(html).length, 3)
})

test('insertEvent writes before the last </body>', () => {
  const out = insertEvent('<body><p>a</p></body></html>', { op: 'add', id: 'c-1' })
  assert.match(out, /<p>a<\/p><!-- comment \{"op":"add","id":"c-1"\} -->\n<\/body><\/html>$/)
})

test('makeEvent stamps its own id and time, and refuses what is not an event', () => {
  const e = make({ op: 'add', name: '  Ann ', text: ' hi ', frame: 'a.html', x: 1.6, y: 2.4, id: 'c-forged', at: 'then' })
  assert.equal(e.name, 'Ann')
  assert.equal(e.text, 'hi')
  assert.equal(e.at, now.toISOString())
  assert.notEqual(e.id, 'c-forged')
  assert.deepEqual([e.x, e.y], [2, 2])
  assert.throws(() => make({ op: 'add', name: '', text: 'x', x: 0, y: 0 }), /name is required/)
  assert.throws(() => make({ op: 'add', name: 'A', text: 'x'.repeat(4001), x: 0, y: 0 }), /longer than 4000/)
  assert.throws(() => make({ op: 'add', name: 'A', text: 'x', x: 'far', y: 0 }), /x is not a number/)
  assert.throws(() => make({ op: 'reply', name: 'A', text: 'x', to: 'not an id' }), /to is not an id/)
  assert.throws(() => make({ op: 'nope', name: 'A' }), /op must be/)
})

test('an add pinned to an element keeps its file, anchor and agent flag', () => {
  const e = make({ op: 'add', name: 'A', text: 't', frame: 'home.html', x: 0, y: 0, anchor: { path: '#hero > 2', dx: 3.2, dy: 4 }, agent: true })
  assert.deepEqual([e.file, e.anchor, e.agent], ['home.html', { path: '#hero > 2', dx: 3, dy: 4 }, true])
  const plain = make({ op: 'add', name: 'A', text: 't', frame: null, x: 0, y: 0, anchor: { dx: 1 } })
  assert.equal(plain.anchor, undefined)
})

test('threads fold in order: replies, resolve, the agent flag, and deletes', () => {
  const a = make({ op: 'add', name: 'A', text: 'first', frame: null, x: 0, y: 0 })
  const b = make({ op: 'add', name: 'B', text: 'second', frame: null, x: 0, y: 0 })
  const r = make({ op: 'reply', name: 'C', text: 'answer', to: a.id })
  const r2 = make({ op: 'reply', name: 'D', text: 'gone', to: a.id })
  const events = [a, b, r, r2, make({ op: 'delete', name: 'D', to: r2.id }), make({ op: 'resolve', name: 'A', to: a.id }), make({ op: 'agent', name: 'A', to: a.id }), make({ op: 'delete', name: 'B', to: b.id })]
  const threads = foldEvents(events)
  assert.equal(threads.length, 1)
  assert.deepEqual(threads[0].replies.map((x) => x.text), ['answer'])
  assert.equal(threads[0].resolved, true)
  assert.equal(threads[0].resolvedBy, 'A')
  assert.equal(threads[0].agent, true)
  const reopened = foldEvents([...events, make({ op: 'resolve', name: 'A', to: a.id, resolved: false }), make({ op: 'agent', name: 'A', to: a.id, agent: false })])
  assert.equal(reopened[0].resolved, false)
  assert.equal(reopened[0].agent, false)
})

test('board lines fold: an item merges, a remove drops it, a frame moves onto a page, pages and the name', () => {
  const item = board({ op: 'item', kind: 'note', x: 1, y: 2, w: 300, h: 200, text: 'a', page: 'p1' })
  const events = [
    item,
    board({ op: 'item', id: item.id, text: 'b' }),
    board({ op: 'item', kind: 'pencil', x: 0, y: 0, w: 10, h: 10, points: [0, 0, 5.4, 9.6] }),
    board({ op: 'move', key: 'home.html', x: 10, y: 20, page: 'p-2abc' }),
    board({ op: 'move', key: 'home.html', x: 30, y: 40 }),
    board({ op: 'page', id: 'p-2abc', title: 'Second' }),
    board({ op: 'page', id: 'p-2abc', title: 'Spare' }),
    board({ op: 'page', id: 'p-3abc', title: 'Gone' }),
    board({ op: 'page', id: 'p-3abc', removed: true }),
    board({ op: 'name', title: 'Renamed' }),
  ]
  const f = foldBoard(events)
  const note = f.items.find((i) => i.kind === 'note')
  assert.deepEqual([note.text, note.x, note.page], ['b', 1, 'p1'])
  assert.deepEqual(f.items.find((i) => i.kind === 'pencil').points, [0, 0, 5, 10])
  assert.deepEqual(f.moved['home.html'], { x: 30, y: 40, page: 'p-2abc' })
  assert.deepEqual(f.pages.map((p) => [p.title, !!p.removed]), [['Spare', false], ['Gone', true]])
  assert.equal(f.name, 'Renamed')
  assert.equal(foldBoard([...events, board({ op: 'remove', id: item.id })]).items.some((i) => i.id === item.id), false)
})

test('makeBoardEvent refuses kinds, page ids and points it does not know', () => {
  assert.throws(() => board({ op: 'item', kind: 'star' }), /kind must be one of/)
  assert.throws(() => board({ op: 'move', key: 'a.html', x: 0, y: 0, page: 'Not An Id!' }), /page is not a page id/)
  assert.throws(() => board({ op: 'item', kind: 'pencil', points: 'lots' }), /points is not a list/)
  assert.throws(() => board({ op: 'name', title: '' }), /title is required/)
  assert.equal(board({ op: 'item', kind: 'guide', frame: 'home.html', cols: 12, gutter: 24, margin: 80 }).cols, 12)
})

test('an arrow binds its ends to objects or frames, and an end let go of folds away', () => {
  const box = board({ op: 'item', kind: 'rect', x: 0, y: 0, w: 100, h: 80, text: 'Start' })
  const section = board({ op: 'item', kind: 'section', x: -50, y: -50, w: 900, h: 600, text: 'Plan' })
  const arrow = board({ op: 'item', kind: 'arrow', x: 0, y: 0, w: 10, h: 10, points: [0, 0, 10, 10], from: box.id, to: 'home.html#s-quiz' })
  assert.deepEqual([arrow.from, arrow.to], [box.id, 'home.html#s-quiz'])
  const f = foldBoard([box, section, arrow, board({ op: 'item', id: arrow.id, to: '' })])
  const a = f.items.find((i) => i.id === arrow.id)
  assert.deepEqual([a.from, a.to], [box.id, ''])
  assert.deepEqual(f.items.find((i) => i.id === box.id).text, 'Start')
  assert.equal(f.items.find((i) => i.id === section.id).kind, 'section')
})

test('a comment about a region keeps its box and the objects in it', () => {
  const e = make({ op: 'add', name: 'A', text: 'what is missing here?', frame: null, x: 10, y: 20, agent: true, box: { x: 10.4, y: 20, w: 300, h: -5 }, items: ['b-abcdef', 'home.html'] })
  assert.deepEqual(e.box, { x: 10, y: 20, w: 300, h: 0 })
  assert.deepEqual(e.items, ['b-abcdef', 'home.html'])
  const [t] = foldEvents([e])
  assert.deepEqual([t.box, t.items], [e.box, e.items])
  assert.throws(() => make({ op: 'add', name: 'A', text: 't', frame: null, x: 0, y: 0, items: 'b-abcdef' }), /items is not a list/)
  const plain = make({ op: 'add', name: 'A', text: 't', frame: null, x: 0, y: 0 })
  assert.equal('box' in plain || 'items' in plain, false)
})

test('board objects grouped share a group id, and an empty one ungroups', () => {
  const a = board({ op: 'item', kind: 'note', x: 0, y: 0, w: 10, h: 10 })
  const b = board({ op: 'item', kind: 'rect', x: 20, y: 0, w: 10, h: 10 })
  const grouped = [a, b, board({ op: 'item', id: a.id, group: 'g-abc123def4' }), board({ op: 'item', id: b.id, group: 'g-abc123def4' })]
  assert.deepEqual(foldBoard(grouped).items.map((i) => i.group), ['g-abc123def4', 'g-abc123def4'])
  assert.deepEqual(foldBoard([...grouped, board({ op: 'item', id: a.id, group: '' })]).items.map((i) => i.group), ['', 'g-abc123def4'])
  for (const g of ['x', '"><b>', 'g-ABC123DEF4', 5]) assert.throws(() => board({ op: 'item', id: a.id, group: g }), /group is not an id/)
})

test('a board colour is a colour, never markup or a style that fetches', () => {
  for (const c of ['#fde68a', 'tomato', 'rgb(1, 2, 3)', 'hsla(10 50% 50% / 0.5)', '']) assert.equal(board({ op: 'item', kind: 'rect', color: c }).color, c)
  for (const c of ['"><img src=x onerror=alert(1)>', 'red;background:url(//x)', 'url(//x)', 'expression(alert(1))']) assert.throws(() => board({ op: 'item', kind: 'arrow', color: c }), /color is not a colour/)
})

test('a comment anchor keeps the tag and words of its element, and nothing else', () => {
  const e = make({ op: 'add', name: 'A', text: 't', frame: null, file: 'a.html', x: 0, y: 0, anchor: { path: 'body > 1', dx: 2, dy: 3, tag: 'p', text: '4.8 mi', extra: 'x' } })
  assert.deepEqual(e.anchor, { path: 'body > 1', dx: 2, dy: 3, tag: 'p', text: '4.8 mi' })
  const odd = make({ op: 'add', name: 'A', text: 't', frame: null, file: 'a.html', x: 0, y: 0, anchor: { path: 'body > 1', tag: '<img onerror=x>', text: 7 } })
  assert.deepEqual(odd.anchor, { path: 'body > 1', dx: 0, dy: 0 })
})

test('an empty title size or guide setting is the default again', () => {
  const t = board({ op: 'item', kind: 'title', x: 0, y: 0, size: 48 })
  assert.equal(board({ op: 'item', id: t.id, size: '' }).size, '')
  assert.equal(board({ op: 'item', id: t.id, size: 9999 }).size, 400)
  assert.equal(board({ op: 'item', id: t.id, cols: '' }).cols, '')
  assert.throws(() => board({ op: 'item', id: t.id, size: 'big' }), /size is not a number/)
})

test('a picture on the board: a file in the folder by its path, never an address elsewhere', () => {
  const pic = makeBoardEvent({ op: 'item', kind: 'image', page: 'p1', src: 'images/swell-chart.png', x: 0, y: 0, w: 300, h: 200 })
  assert.equal(pic.kind, 'image')
  assert.equal(pic.src, 'images/swell-chart.png')
  assert.equal(foldBoard([pic]).items[0].src, 'images/swell-chart.png')
  for (const bad of ['https://example.com/a.png', '../secret.png', '/etc/a.png', 'javascript:alert(1).png', 'images/a.html', 'images/../a.png', '']) {
    assert.throws(() => makeBoardEvent({ op: 'item', kind: 'image', src: bad }), /src is not a picture in the folder/, bad)
  }
})
