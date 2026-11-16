// One option's column cut out of a board that sets several options side by side, in the page
// itself; returns how wide it draws. Runs in the measuring browser and, as text, in every frame
// and Play that shows a cut. A column is marked `data-option="A"`, a lettered badge
// `<span class="n">A</span>`, or a label reading "Option A —". The board's own heading, which
// compares and so belongs to no option, is hidden with the other columns.
export function cropToOption(letter) {
  const marks = []
  for (const el of document.querySelectorAll('[data-option]')) marks.push([el, el.getAttribute('data-option')])
  if (!marks.length) for (const el of document.querySelectorAll('span.n')) if (/^[A-Z]$/.test(el.textContent.trim())) marks.push([el, el.textContent.trim()])
  if (!marks.length) {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walk.nextNode()) {
      const m = /^\s*Option ([A-Z])\s*[—–:-]/.exec(walk.currentNode.data)
      if (m) marks.push([walk.currentNode.parentElement, m[1]])
    }
  }
  // A column is the biggest box round a mark that holds no other option's mark.
  const cols = new Map()
  for (const [el, l] of marks) {
    let e = el
    while (e.parentElement && e.parentElement !== document.body && !marks.some(([m, ml]) => ml !== l && e.parentElement.contains(m))) e = e.parentElement
    if (!cols.has(e)) cols.set(e, l)
  }
  // An option's part runs from its mark's box to the next marked box beside it, so a board that
  // stacks its options under headings cuts the same way as one that sets them in columns.
  const skip = /^(svg|style|script|template|link|meta)$/i
  const hide = (el) => el.style.setProperty('display', 'none', 'important')
  const parents = new Set([...cols.keys()].map((e) => e.parentElement))
  const kept = []
  for (const parent of parents) {
    let cur = null
    for (const child of parent.children) {
      if (cols.has(child)) cur = cols.get(child)
      if (skip.test(child.tagName)) continue
      if (cur === letter) kept.push(child)
      else hide(child)
    }
  }
  if (!kept.length) return null
  for (const parent of parents) {
    for (let up = parent; up && up !== document.body; up = up.parentElement) {
      for (const sib of up.parentElement.children) {
        if (sib !== up && !skip.test(sib.tagName) && !kept.some((k) => sib.contains(k))) hide(sib)
      }
    }
  }
  const boxes = kept.map((k) => k.getBoundingClientRect()).filter((r) => r.width)
  const left = Math.min(...boxes.map((r) => r.left))
  const right = Math.max(...boxes.map((r) => r.right))
  return { w: Math.ceil(right + Math.max(24, left)) }
}
