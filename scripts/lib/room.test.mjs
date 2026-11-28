import assert from 'node:assert/strict'
import test from 'node:test'
import { makeRoom } from './room.mjs'

test('a room tells each person who else is there, where their pointer is, and when they go', () => {
  let n = 0
  const room = makeRoom({ newId: () => `p${++n}` })
  const got = { a: [], b: [] }
  const a = room.join((m) => got.a.push(m))
  const b = room.join((m) => got.b.push(m))
  a.message(JSON.stringify({ t: 'hello', name: 'Ana' }))
  assert.deepEqual(got.a.at(-1), { t: 'welcome', id: 'p1', color: got.a.at(-1).color, peers: [] })
  assert.equal(got.b.length, 0, 'nobody is told of someone until they have said hello themselves')
  b.message(JSON.stringify({ t: 'hello', name: 'Sam' }))
  assert.equal(got.b.at(-1).peers[0].name, 'Ana')
  assert.equal(got.a.at(-1).t, 'join')
  assert.equal(got.a.at(-1).name, 'Sam')
  assert.notEqual(got.a.at(-1).color, got.b.at(-1).peers[0].color, 'each has their own color')
  a.message(JSON.stringify({ t: 'cursor', page: 'p1', x: 10.04, y: -20 }))
  assert.deepEqual(got.b.at(-1), { t: 'cursor', id: 'p1', page: 'p1', x: 10, y: -20 })
  a.message(JSON.stringify({ t: 'cursor', page: null }))
  assert.deepEqual(got.b.at(-1), { t: 'cursor', id: 'p1', page: null })
  const before = got.b.length
  a.message('not json')
  a.message(JSON.stringify({ t: 'cursor', page: 'p1', x: 'left', y: 3 }))
  assert.equal(got.b.at(-1).page, null, 'a point that is not a number is nowhere')
  a.message('x'.repeat(5000))
  assert.equal(got.b.length, before + 1, 'bad and oversized messages go nowhere')
  a.leave()
  assert.deepEqual(got.b.at(-1), { t: 'leave', id: 'p1' })
  assert.equal(room.size, 1)
})
