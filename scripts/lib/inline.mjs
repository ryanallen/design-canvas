// A prototype made self-contained, so the canvas fetches nothing: its local stylesheets shared
// once across every prototype, its scripts, images and fonts written in, and anything off the
// machine left out with a note saying so.
import fs from 'node:fs'
import path from 'node:path'

const mime = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' }

const local = (from, ref) => {
  if (/^(data:|https?:|\/\/|#|mailto:|about:|javascript:)/i.test(ref)) return null
  let clean
  try {
    clean = decodeURIComponent(ref.split(/[?#]/)[0])
  } catch {
    return null
  }
  const full = path.resolve(path.dirname(from), clean)
  return fs.existsSync(full) && fs.statSync(full).isFile() ? full : null
}
const dataUri = (full) => `data:${mime[path.extname(full).toLowerCase()] ?? 'application/octet-stream'};base64,${fs.readFileSync(full).toString('base64')}`

export function inlineCss(css, from, warnings) {
  return css
    .replace(/@import\s+(?:url\()?["']?([^"')]+)["']?\)?\s*;/g, (all, ref) => {
      const full = local(from, ref)
      return full ? inlineCss(fs.readFileSync(full, 'utf8'), full, warnings) : (warnings.push(`${path.basename(from)} imports ${ref}, which is left out`), '')
    })
    .replace(/url\((['"]?)([^)'"]+)\1\)/g, (all, q, ref) => {
      if (/^https?:/i.test(ref)) {
        warnings.push(`${path.basename(from)} fetches ${ref}, which is left out`)
        return 'url()'
      }
      const full = local(from, ref)
      return full ? `url("${dataUri(full)}")` : all
    })
}

/**
 * `html` is the prototype's text (tagged or not); `folder` is where its relative references
 * resolve. Stylesheets go into `assets` once, by their path, and the page refers to them with
 * `__RC_ASSET__(<path>)`, which the canvas swaps for the stylesheet when it draws the frame.
 */
export function inlineFile(folder, file, html, assets, warnings, { keepMedia = false } = {}) {
  const from = path.join(folder, file)
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = /\bhref="([^"]+)"/i.exec(tag)?.[1]
    const rel = /\brel="([^"]+)"/i.exec(tag)?.[1] ?? ''
    if (!href) return tag
    if (/^https?:|^\/\//i.test(href)) {
      if (/stylesheet/i.test(rel)) warnings.push(`${file} loads ${href}, which is left out; the canvas fetches nothing`)
      return ''
    }
    const full = local(from, href)
    if (!full) return tag
    if (/stylesheet/i.test(rel)) {
      const name = path.relative(folder, full).replace(/\\/g, '/')
      if (!assets[name]) assets[name] = { type: 'text/css', text: inlineCss(fs.readFileSync(full, 'utf8'), full, warnings) }
      return tag.replace(href, `__RC_ASSET__(${name})`)
    }
    if (/icon/i.test(rel)) return tag.replace(href, dataUri(full))
    return tag
  })
  html = html.replace(/<script\b([^>]*)\ssrc="([^"]+)"([^>]*)><\/script>/gi, (tag, a, src, b) => {
    if (/^https?:|^\/\//i.test(src)) {
      warnings.push(`${file} loads ${src}, which is left out`)
      return ''
    }
    const full = local(from, src)
    return full ? `<script${a}${b}>${fs.readFileSync(full, 'utf8').replace(/<\/script/gi, '<\\/script')}</script>` : tag
  })
  // Served, pictures and media keep their paths and the server answers them, so a page script that reads an image's
  // src still finds its file name; built, each is written in.
  if (!keepMedia) html = html.replace(/(<(?:img|source|video|audio)\b[^>]*?\s(?:src|poster)=")([^"]+)(")/gi, (all, pre, ref, post) => {
    const full = local(from, ref)
    return full ? `${pre}${dataUri(full)}${post}` : all
  })
  html = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (all, attrs, css) => `<style${attrs}>${inlineCss(css, from, warnings)}</style>`)
  return html
}
