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
  assert.deepEqual(got.a.at(-1), { t: 'welcome', id: 'p1', color: got.a.at(-1).color, peers: [], host: false, edit: false })
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

test('a room made again from what each person kept is the room it was', () => {
  let n = 0
  const room = makeRoom({ newId: () => `p${++n}` })
  const a = room.join(() => {})
  const b = room.join(() => {})
  a.message(JSON.stringify({ t: 'hello', name: 'Ana' }))
  b.message(JSON.stringify({ t: 'hello', name: 'Sam' }))
  a.message(JSON.stringify({ t: 'cursor', page: 'p1', x: 1, y: 2 }))
  const kept = [a.state, b.state]
  const again = makeRoom()
  const got = []
  const a2 = again.join(() => {}, kept[0])
  again.join((m) => got.push(m), kept[1])
  a2.message(JSON.stringify({ t: 'cursor', page: 'p1', x: 3, y: 4 }))
  assert.deepEqual(got.at(-1), { t: 'cursor', id: 'p1', page: 'p1', x: 3, y: 4 })
  assert.notEqual(kept[0].color, kept[1].color)
})

test("a guest's calls reach the owner's canvas only with the edit key, and only its answer comes back to them", () => {
  let n = 0
  const room = makeRoom({ newId: () => `p${++n}`, ownerKey: 'owner-secret' })
  const got = { host: [], ana: [], sam: [], fake: [] }
  const host = room.join((m) => got.host.push(m))
  const ana = room.join((m) => got.ana.push(m))
  const sam = room.join((m) => got.sam.push(m))
  const fake = room.join((m) => got.fake.push(m))
  fake.message(JSON.stringify({ t: 'hello', host: true, key: 'guess', editKey: 'x' }))
  assert.equal(got.fake.at(-1).t, 'refused', 'a wrong owner key is refused')
  ana.message(JSON.stringify({ t: 'hello', name: 'Ana', key: 'invite-1' }))
  sam.message(JSON.stringify({ t: 'hello', name: 'Sam' }))
  const call = JSON.stringify({ t: 'call', n: 1, method: 'POST', path: '/api/edit', body: '{}' })
  ana.message(call)
  assert.equal(got.ana.at(-1).status, 503, "with no owner's canvas there, a call is answered at once")
  host.message(JSON.stringify({ t: 'hello', host: true, key: 'owner-secret', editKey: 'invite-1' }))
  assert.deepEqual(got.ana.at(-1), { t: 'host', on: true, edit: true })
  assert.deepEqual(got.sam.at(-1), { t: 'host', on: true, edit: false })
  assert.ok(!got.ana.some((m) => m.t === 'join' && m.name === 'canvas'), 'the host is not a person in the room')
  ana.message(call)
  assert.deepEqual(got.host.at(-1), { t: 'call', from: 'p2', name: 'Ana', n: 1, method: 'POST', path: '/api/edit', body: '{}' })
  sam.message(call)
  assert.equal(got.sam.at(-1).status, 403, 'without the edit key, no call goes through')
  assert.equal(got.host.filter((m) => m.t === 'call').length, 1)
  host.message(JSON.stringify({ t: 'answer', to: 'p2', n: 1, status: 200, body: '{"ok":true}' }))
  assert.deepEqual(got.ana.at(-1), { t: 'answer', n: 1, status: 200, body: '{"ok":true}' })
  assert.ok(!got.sam.some((m) => m.t === 'answer' && m.status === 200), "an answer goes to the one who asked, no one else")
  host.message(JSON.stringify({ t: 'tell', event: 'file', data: { file: 'a.html' } }))
  assert.deepEqual(got.sam.at(-1), { t: 'tell', event: 'file', data: { file: 'a.html' } })
  for (let i = 0; i < 40; i++) ana.message(call)
  assert.ok(got.ana.some((m) => m.status === 429), 'too many calls a second are turned away')
  host.leave()
  assert.deepEqual(got.ana.at(-1), { t: 'host', on: false, edit: false })
})

test('what someone is looking at goes to the others, for following them', () => {
  const room = makeRoom()
  const got = []
  const a = room.join(() => {})
  const b = room.join((m) => got.push(m))
  a.message(JSON.stringify({ t: 'hello', name: 'Ana' }))
  b.message(JSON.stringify({ t: 'hello', name: 'Sam' }))
  a.message(JSON.stringify({ t: 'view', page: 'p1', x: 100, y: 50, z: 0.5 }))
  assert.deepEqual(got.at(-1), { t: 'view', id: a.id, page: 'p1', x: 100, y: 50, z: 0.5 })
  a.message(JSON.stringify({ t: 'view', page: 'p1', x: 1, y: 1, z: 'far' }))
  assert.equal(got.at(-1).x, 100, 'a view without a zoom goes nowhere')
})
