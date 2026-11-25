// A web font: Google's answer read for its latin files, the sheet written beside them, the link put in the head once,
// and the download into a folder with a stand-in for the network.
// node --test scripts/lib/webfont.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyEdit } from './html.mjs'
import { faceSheet, familyValue, fetchWebFont, latinFaces, linkSheet, slugOf } from './webfont.mjs'

const google = `/* cyrillic */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v1/cyr.woff2) format('woff2');
  unicode-range: U+0301, U+0400-045F;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v1/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: italic;
  font-weight: 100 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v1/latin-i.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}
`

test('only the latin faces are taken, with their weight range and style', () => {
  const faces = latinFaces(google)
  assert.deepEqual(faces.map((f) => [f.style, f.weight, f.url.split('/').pop()]), [['normal', '100 900', 'latin.woff2'], ['italic', '100 900', 'latin-i.woff2']])
})

test('a file from anywhere but Google is not taken', () => {
  assert.equal(latinFaces(google.replace(/fonts\.gstatic\.com/g, 'evil.example')).length, 0)
})

test('the sheet points each face at its own file beside it', () => {
  const css = faceSheet('Inter', 'inter', latinFaces(google))
  assert.match(css, /font-weight: 100 900;\n  font-display: swap;\n  src: url\("inter\/100-900-normal\.woff2"\)/)
  assert.match(css, /url\("inter\/100-900-italic\.woff2"\)/)
  assert.equal(slugOf('Plus Jakarta Sans'), 'plus-jakarta-sans')
  assert.equal(familyValue('Fira Code'), '"Fira Code", monospace')
})

test('the link goes in the head once', () => {
  const html = '<!doctype html>\n<html>\n  <head>\n    <title>t</title>\n  </head>\n<body></body></html>\n'
  const once = linkSheet(html, 'fonts/inter.css')
  assert.equal(once, '<!doctype html>\n<html>\n  <head>\n    <title>t</title>\n    <link rel="stylesheet" href="fonts/inter.css">\n  </head>\n<body></body></html>\n')
  assert.equal(linkSheet(once, 'fonts/inter.css'), once)
  assert.equal(linkSheet('<html><head><title>t</title></head><body>', 'f.css'), '<html><head><title>t</title><link rel="stylesheet" href="f.css"></head><body>')
})

test('a family is downloaded once into the folder, each file whole', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'webfont-'))
  const asked = []
  const fetchImpl = async (url) => {
    asked.push(url)
    if (url.startsWith('https://fonts.googleapis.com/')) return { ok: true, text: async () => google }
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(`woff2 of ${url}`).buffer }
  }
  const first = await fetchWebFont(folder, 'Inter', { fetchImpl })
  assert.deepEqual(first, { sheet: 'fonts/inter.css', fetched: 2 })
  assert.deepEqual(fs.readdirSync(path.join(folder, 'fonts', 'inter')).sort(), ['100-900-italic.woff2', '100-900-normal.woff2'])
  assert.equal(asked.length, 3)
  const again = await fetchWebFont(folder, 'Inter', { fetchImpl })
  assert.equal(again.fetched, 0)
  assert.equal(asked.length, 3)
  await assert.rejects(fetchWebFont(folder, 'Not A Font', { fetchImpl }), /not one of the web fonts/)
  fs.rmSync(folder, { recursive: true, force: true })
})

test('the link edit keeps the selected element selected and takes only a sheet in the folder', () => {
  const src = '<html>\n<head>\n<title>t</title>\n</head>\n<body><h1>Hi</h1></body></html>\n'
  const cv = src.indexOf('<h1>')
  const r = applyEdit(src, { op: 'link', href: 'fonts/inter.css', cv })
  assert.equal(r.src.slice(r.select, r.select + 4), '<h1>')
  assert.equal(applyEdit(r.src, { op: 'link', href: 'fonts/inter.css', cv: r.select }).src, r.src)
  assert.match(applyEdit(src, { op: 'link', href: '../fonts/inter.css', cv }).src, /href="\.\.\/fonts\/inter\.css"/)
  for (const href of ['https://evil.example/x.css', '/etc/x.css', 'fonts/x.js', 'a"onload="x.css']) assert.throws(() => applyEdit(src, { op: 'link', href, cv }), /must be a .css file/)
})
