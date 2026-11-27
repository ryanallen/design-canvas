import assert from 'node:assert/strict'
import test from 'node:test'
import { rebase } from './rebase.mjs'

const before = '<section>\n  <h1>Know when to paddle out.</h1>\n  <p>Tides, swell and wind.</p>\n  <a>Free</a>\n</section>\n'
const colored = before.replace('<h1>', '<h1 style="color: red">')

test('nothing changed since: the change is made as it was', () => {
  assert.equal(rebase(colored, colored, before), before)
})

test('a change made after it, or before it, elsewhere in the file: the change is undone and the other kept', () => {
  const below = colored.replace('<a>Free</a>', '<a>Free</a>\n  <small>New</small>')
  assert.equal(rebase(below, colored, before), before.replace('<a>Free</a>', '<a>Free</a>\n  <small>New</small>'))
  const above = colored.replace('<section>\n', '<section>\n  <p class="eyebrow">New this week</p>\n')
  assert.equal(rebase(above, colored, before), before.replace('<section>\n', '<section>\n  <p class="eyebrow">New this week</p>\n'))
})

test('changes on both sides of it: found by what stands next to it', () => {
  const both = colored.replace('<section>\n', '<section>\n  <p class="eyebrow">New</p>\n').replace('<a>Free</a>', '<a>Gratis</a>')
  assert.equal(rebase(both, colored, before), before.replace('<section>\n', '<section>\n  <p class="eyebrow">New</p>\n').replace('<a>Free</a>', '<a>Gratis</a>'))
  // A redo onto words rewritten right after it and a line added right before it.
  const close = before.replace('<section>\n', '<section>\n  <p>x</p>\n').replace('Know when to paddle out.', 'Paddle out at dawn.')
  assert.equal(rebase(close, before, colored), close.replace('<h1>', '<h1 style="color: red">'))
})

test('the part it changed was itself changed: null, nothing made', () => {
  const recolored = colored.replace('color: red', 'color: blue')
  assert.equal(rebase(recolored, colored, before), null)
})

test('the same words elsewhere are not taken for the part when its own place was rewritten', () => {
  const src = '<p>Plan: Free</p>\n<ul><li>Free</li></ul>\n'
  const changed = src.replace('<p>Plan: Free</p>', '<p>Plan: Paid</p>')
  const rewritten = changed.replace('<p>Plan: Paid</p>', '<p>Pick one</p>')
  assert.equal(rebase(rewritten, changed, src), null)
  // Redone after its place was rewritten: the other "Free" is left alone.
  const gone = src.replace('<p>Plan: Free</p>', '<p>Pick one</p>')
  assert.equal(rebase(gone, src, changed), null)
})
