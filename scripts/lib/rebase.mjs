/**
 * A change from one text to another made again on a text that has moved on since (an agent wrote other parts of the
 * file), as an undo or redo after it: the part that changed is changed the same way where it now stands. Null when that
 * part is not there as it was, or cannot be told from another like it: the change is not made by guessing.
 *
 * Where it stands: when the step's change lies wholly before, or wholly after, everything that changed since, it is at
 * the same place, moved by what changed before it. Otherwise it is found by what stood either side of it, as much as is
 * still there (at least 4 characters), and only where that is found exactly once.
 */
export function rebase(cur, from, to) {
  if (cur === from) return to
  let p = 0
  while (p < from.length && p < to.length && from[p] === to[p]) p++
  let s = 0
  while (s < from.length - p && s < to.length - p && from[from.length - 1 - s] === to[to.length - 1 - s]) s++
  const end = from.length - s
  const mid = from.slice(p, end)
  const put = to.slice(p, to.length - s)
  // What changed since: everything between the part cur and from begin with and the part they end with.
  let a = 0
  while (a < cur.length && a < from.length && cur[a] === from[a]) a++
  let b = 0
  while (b < cur.length - a && b < from.length - a && cur[cur.length - 1 - b] === from[from.length - 1 - b]) b++
  if (end <= a) return cur.slice(0, p) + put + cur.slice(end)
  if (p >= from.length - b) {
    const d = cur.length - from.length
    return cur.slice(0, p + d) + put + cur.slice(end + d)
  }
  const sizes = [60, 32, 16, 8, 4, 0]
  for (const h of sizes) {
    for (const t of sizes) {
      const head = from.slice(Math.max(0, p - h), p)
      const tail = from.slice(end, end + t)
      if (head.length + tail.length < 4) continue
      const needle = head + mid + tail
      const at = cur.indexOf(needle)
      if (at < 0 || cur.indexOf(needle, at + 1) >= 0) continue
      return cur.slice(0, at + head.length) + put + cur.slice(at + head.length + mid.length)
    }
  }
  return null
}
