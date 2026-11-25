// A web font for a prototype: the family's woff2 files from Google Fonts, downloaded once into the prototype's folder
// under fonts/<family>/, with fonts/<family>.css holding their @font-face rules. The prototype links that sheet as a
// file of its own, so it opens offline, and the canvas writes it in like any other stylesheet.
import fs from 'node:fs'
import path from 'node:path'
import { linkSheet } from './html.mjs'

export { linkSheet }

/** Families offered as web fonts, with the generic family each falls back to. */
export const WEB_FONTS = [
  ['Inter', 'sans-serif'], ['Roboto', 'sans-serif'], ['Open Sans', 'sans-serif'], ['Lato', 'sans-serif'], ['Montserrat', 'sans-serif'],
  ['Poppins', 'sans-serif'], ['Source Sans 3', 'sans-serif'], ['Nunito', 'sans-serif'], ['Raleway', 'sans-serif'], ['Work Sans', 'sans-serif'],
  ['DM Sans', 'sans-serif'], ['Outfit', 'sans-serif'], ['Manrope', 'sans-serif'], ['Plus Jakarta Sans', 'sans-serif'], ['IBM Plex Sans', 'sans-serif'],
  ['Noto Sans', 'sans-serif'], ['Rubik', 'sans-serif'], ['Figtree', 'sans-serif'], ['Space Grotesk', 'sans-serif'], ['Archivo', 'sans-serif'],
  ['Merriweather', 'serif'], ['Playfair Display', 'serif'], ['Lora', 'serif'], ['Source Serif 4', 'serif'], ['Noto Serif', 'serif'],
  ['EB Garamond', 'serif'], ['Libre Baskerville', 'serif'], ['Crimson Pro', 'serif'], ['Fraunces', 'serif'], ['DM Serif Display', 'serif'],
  ['IBM Plex Serif', 'serif'], ['Cormorant Garamond', 'serif'],
  ['JetBrains Mono', 'monospace'], ['Fira Code', 'monospace'], ['IBM Plex Mono', 'monospace'], ['Source Code Pro', 'monospace'], ['Space Mono', 'monospace'],
  ['Caveat', 'cursive'], ['Pacifico', 'cursive'], ['Dancing Script', 'cursive'],
]

const OFFERED = new Map(WEB_FONTS)
export const slugOf = (family) => family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
/** The value a prototype's CSS names the family by. */
export const familyValue = (family) => `"${family}", ${OFFERED.get(family) ?? 'sans-serif'}`

/**
 * The latin @font-face rules of a Google Fonts css2 answer: each face's style, weight (a range for a variable font)
 * and woff2 address. Google marks each subset with a comment before its rule; latin is the one a page in English needs.
 */
export function latinFaces(css) {
  const faces = []
  for (const m of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    if (m[1] !== 'latin') continue
    const body = m[2]
    const url = /src:\s*url\(([^)]+\.woff2)\)/.exec(body)?.[1]
    const weight = /font-weight:\s*([\d ]+);/.exec(body)?.[1]?.trim()
    const style = /font-style:\s*(\w+);/.exec(body)?.[1] ?? 'normal'
    const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim()
    if (url && weight && /^https:\/\/fonts\.gstatic\.com\//.test(url)) faces.push({ url, weight, style, range })
  }
  return faces
}

/** The stylesheet written beside the files: one @font-face a face, each pointing at its file in fonts/<slug>/. */
export function faceSheet(family, slug, faces) {
  return faces.map((f) => `@font-face {\n  font-family: "${family}";\n  font-style: ${f.style};\n  font-weight: ${f.weight};\n  font-display: swap;\n  src: url("${slug}/${fileOf(f)}") format("woff2");${f.range ? `\n  unicode-range: ${f.range};` : ''}\n}\n`).join('')
}
const fileOf = (f) => `${f.weight.replace(/\s+/g, '-')}-${f.style}.woff2`

// A browser's name, so Google answers with woff2 files.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

/**
 * Downloads `family` into `folder`/fonts once and answers the sheet's path from the folder. A family already there is
 * not fetched again. Each file is written whole or not at all.
 */
export async function fetchWebFont(folder, family, { fetchImpl = fetch } = {}) {
  if (!OFFERED.has(family)) throw new Error(`${family} is not one of the web fonts offered`)
  const slug = slugOf(family)
  const sheet = `fonts/${slug}.css`
  const sheetPath = path.join(folder, 'fonts', `${slug}.css`)
  if (fs.existsSync(sheetPath)) return { sheet, fetched: 0 }
  const q = family.replace(/ /g, '+')
  // Every weight a variable family has, regular and italic; a family without italics or a range is asked more plainly.
  let css = null
  for (const spec of [`:ital,wght@0,100..900;1,100..900`, `:wght@100..900`, `:ital,wght@0,400;0,700;1,400;1,700`, `:wght@400;700`, '']) {
    const res = await fetchImpl(`https://fonts.googleapis.com/css2?family=${q}${spec}&display=swap`, { headers: { 'user-agent': UA } })
    if (res.ok) {
      css = await res.text()
      break
    }
  }
  if (!css) throw new Error(`Google Fonts has no ${family}`)
  const faces = latinFaces(css)
  if (!faces.length) throw new Error(`Google Fonts sent no latin files for ${family}`)
  const dir = path.join(folder, 'fonts', slug)
  fs.mkdirSync(dir, { recursive: true })
  for (const f of faces) {
    const res = await fetchImpl(f.url, { headers: { 'user-agent': UA } })
    if (!res.ok) throw new Error(`could not download ${family} (${res.status})`)
    const to = path.join(dir, fileOf(f))
    fs.writeFileSync(`${to}.part`, Buffer.from(await res.arrayBuffer()))
    fs.renameSync(`${to}.part`, to)
  }
  fs.writeFileSync(`${sheetPath}.part`, faceSheet(family, slug, faces))
  fs.renameSync(`${sheetPath}.part`, sheetPath)
  return { sheet, fetched: faces.length }
}
