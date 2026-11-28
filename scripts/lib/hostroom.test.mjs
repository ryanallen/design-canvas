import assert from 'node:assert/strict'
import test from 'node:test'
import { GUEST_CALLS, inviteKey } from './hostroom.mjs'

test('the invite key is the same for one owner key and room, and differs for another room or key', () => {
  const room = 'wss://example.workers.dev/room/abc12345'
  assert.equal(inviteKey('k1', room), inviteKey('k1', room))
  assert.notEqual(inviteKey('k1', room), inviteKey('k1', `${room}x`))
  assert.notEqual(inviteKey('k1', room), inviteKey('k2', room))
  assert.match(inviteKey('k1', room), /^[A-Za-z0-9_-]{24}$/)
})

test('a guest may edit, comment, draw and export pictures, but not make files, fetch fonts or reach the agent', () => {
  for (const p of ['/api/edit', '/api/undo', '/api/board', '/api/canvas-comments']) assert.ok(GUEST_CALLS.POST.includes(p), p)
  for (const p of ['/api/png', '/api/pdf', '/api/board-png']) assert.ok(GUEST_CALLS.GET.includes(p) && !GUEST_CALLS.POST.includes(p), p)
  for (const p of ['/api/artboard', '/api/font', '/api/agent', '/api/selection', '/api/canvas', '/api/image', '/api/refresh']) {
    assert.ok(!GUEST_CALLS.POST.includes(p) && !GUEST_CALLS.GET.includes(p), p)
  }
})
