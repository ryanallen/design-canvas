import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { writeFileAtomic } from './write.mjs'

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-write-'))

test('a new file is written whole, and nothing else is left in the folder', () => {
  const dir = folder()
  const file = path.join(dir, 'a.html')
  writeFileAtomic(file, '<p>one</p>')
  assert.equal(fs.readFileSync(file, 'utf8'), '<p>one</p>')
  assert.deepEqual(fs.readdirSync(dir), ['a.html'])
})

test('a file written again holds the new text alone', () => {
  const dir = folder()
  const file = path.join(dir, 'a.html')
  fs.writeFileSync(file, 'a much longer old text than the new one')
  writeFileAtomic(file, 'new')
  assert.equal(fs.readFileSync(file, 'utf8'), 'new')
  assert.deepEqual(fs.readdirSync(dir), ['a.html'])
})

test('a write that fails leaves the old file as it was and no hidden file behind', () => {
  const dir = folder()
  const file = path.join(dir, 'a.html')
  fs.writeFileSync(file, 'old')
  // A directory where the file's target should be: the rename over it fails.
  const blocked = path.join(dir, 'b.html')
  fs.mkdirSync(blocked)
  fs.writeFileSync(path.join(blocked, 'inside'), 'x')
  assert.throws(() => writeFileAtomic(blocked, 'new'))
  assert.equal(fs.readFileSync(file, 'utf8'), 'old')
  assert.deepEqual(fs.readdirSync(dir).sort(), ['a.html', 'b.html'])
})

test('a symbolic link stays a link and its target takes the text', (t) => {
  const dir = folder()
  const real = path.join(dir, 'real.html')
  const link = path.join(dir, 'link.html')
  fs.writeFileSync(real, 'old')
  try {
    fs.symlinkSync(real, link)
  } catch {
    return t.skip('this machine makes no symbolic links without leave')
  }
  writeFileAtomic(link, 'new')
  assert.ok(fs.lstatSync(link).isSymbolicLink())
  assert.equal(fs.readFileSync(real, 'utf8'), 'new')
})
