// A room: everyone with the canvas open sees who else is there and where their pointer is. The room logic imports
// nothing, so a Cloudflare Worker's Durable Object runs the same code the local server does; the local server
// speaks WebSocket to the browsers through `acceptSocket`, written here without any package.

/** The colors people are given in a room, in turn: each readable under white text. */
export const ROOM_COLORS = ['#e5484d', '#0091ff', '#30a46c', '#f76b15', '#8e4ec6', '#d6409f', '#12a594', '#ab6400']
const MAX_PEERS = 50
// A pointer or a name is small; a call, its answer and the host's news carry a prototype's HTML, in parts under the
// 1 MB a Cloudflare WebSocket message may be.
const MAX_SMALL = 2048
const MAX_MESSAGE = 1_000_000
// A guest's calls to the host: at most this many a second, so one page cannot flood the owner's machine.
const CALLS_PER_SECOND = 30

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max)
const num = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null)

/** A room's people. `join(send)` takes a function that sends one message (an object) to that person, and answers
 *  with what to do with each message they send and when they leave, and `state`, what to keep of them. A host that
 *  sleeps between messages (a Durable Object hibernating) keeps each `state` and hands it back with `join(send, state)`
 *  to make the room as it was.
 *
 *  With an `ownerKey`, the owner's canvas server can join as the host (hello with `host: true` and that key). It
 *  names an edit key; a guest whose hello carries that key may send calls (`call`), which go to the host, and the
 *  host's answers (`answer`) go back to that guest alone. What the host tells (`tell`) goes to everyone. The host
 *  is not a person: it has no face or pointer. */
export function makeRoom({ newId = () => Math.random().toString(36).slice(2, 10), ownerKey = '', now = () => Date.now() } = {}) {
  const peers = new Map()
  // The first color nobody here has, so two people never share one while there are colors to go round.
  const nextColor = () => ROOM_COLORS.find((c) => ![...peers.values()].some((p) => p.color === c)) ?? ROOM_COLORS[peers.size % ROOM_COLORS.length]
  const others = (id, msg) => {
    for (const p of peers.values()) if (p.id !== id && p.here && !p.host) p.send(msg)
  }
  const hostNow = () => [...peers.values()].find((p) => p.host && p.here) ?? null
  const mayEdit = (p) => { const h = hostNow(); return !!(h && p.key && h.editKey && p.key === h.editKey) }
  // Each guest is told whether the owner's canvas is there and whether they may edit through it.
  const tellHost = () => {
    for (const p of peers.values()) if (p.here && !p.host) p.send({ t: 'host', on: !!hostNow(), edit: mayEdit(p) })
  }
  const shown = (p) => ({ id: p.id, name: p.name, color: p.color, ...(p.cursor ? { cursor: p.cursor } : {}), ...(p.sel ? { sel: p.sel } : {}), ...(p.spotlight ? { spotlight: true } : {}) })
  return {
    get size() { return peers.size },
    join(send, state = null) {
      if (!state && peers.size >= MAX_PEERS) {
        send({ t: 'full' })
        return null
      }
      const p = state ? { ...state, send } : { id: newId(), name: '', color: nextColor(), cursor: null, send, here: false, host: false, key: '', editKey: '' }
      peers.set(p.id, p)
      let calls = []
      return {
        id: p.id,
        get state() { return { id: p.id, name: p.name, color: p.color, cursor: p.cursor, sel: p.sel ?? null, spotlight: !!p.spotlight, timer: p.timer ?? null, here: p.here, host: !!p.host, key: p.key ?? '', editKey: p.editKey ?? '' } },
        message(text) {
          if (typeof text !== 'string' || text.length > MAX_MESSAGE) return
          let m
          try { m = JSON.parse(text) } catch { return }
          if (!m || typeof m !== 'object') return
          if (!['call', 'answer', 'tell'].includes(m.t) && text.length > MAX_SMALL) return
          if (m.t === 'hello' && m.host) {
            // The owner's canvas: only with the key the room was given. A second host takes over from the first.
            if (!ownerKey || m.key !== ownerKey) return send({ t: 'refused', error: 'That is not the owner key for this room.' })
            for (const o of peers.values()) if (o.host) o.host = false
            Object.assign(p, { host: true, here: true, name: 'canvas', editKey: clean(m.editKey, 128) })
            send({ t: 'welcome', id: p.id, host: true })
            tellHost()
          } else if (m.t === 'hello') {
            p.name = clean(m.name, 80) || 'Someone'
            p.key = clean(m.key, 128)
            // A timer someone set, still running: how long it has left.
            const timer = [...peers.values()].map((o) => o.timer).find((t) => t && t.until > now())
            send({ t: 'welcome', id: p.id, color: p.color, peers: [...peers.values()].filter((o) => o.id !== p.id && o.here && !o.host).map(shown), host: !!hostNow(), edit: mayEdit(p), ...(timer ? { timer: { left: timer.until - now(), by: timer.by } } : {}) })
            if (!p.here) others(p.id, { t: 'join', ...shown(p) })
            p.here = true
          } else if (!p.here) {
            return
          } else if (p.host) {
            if (m.t === 'answer' && peers.has(m.to)) {
              const { to, ...rest } = m
              peers.get(to).send(rest)
            } else if (m.t === 'tell') others(p.id, { t: 'tell', event: clean(m.event, 40), data: m.data ?? null })
          } else if (m.t === 'call') {
            const n = m.n
            const now = Date.now()
            calls = calls.filter((at) => now - at < 1000)
            const h = hostNow()
            if (!h) return send({ t: 'answer', n, status: 503, body: JSON.stringify({ error: "The owner's canvas isn't open right now, so changes can't be saved. They can be once it is." }) })
            if (!mayEdit(p)) return send({ t: 'answer', n, status: 403, body: JSON.stringify({ error: "This link lets you look and comment, but not edit." }) })
            if (calls.length >= CALLS_PER_SECOND) return send({ t: 'answer', n, status: 429, body: JSON.stringify({ error: 'Too many changes at once. Wait a moment.' }) })
            calls.push(now)
            h.send({ t: 'call', from: p.id, name: p.name, n, method: m.method === 'POST' ? 'POST' : 'GET', path: String(m.path ?? '').slice(0, 2000), body: typeof m.body === 'string' ? m.body : null })
            return
          } else if (m.t === 'name') {
            p.name = clean(m.name, 80) || 'Someone'
            others(p.id, { t: 'name', id: p.id, name: p.name })
          } else if (m.t === 'cursor') {
            // Where their pointer is on the board: a page and a point on it, or nowhere (off the board).
            const page = m.page == null ? null : clean(m.page, 240)
            const x = num(m.x)
            const y = num(m.y)
            p.cursor = page && x != null && y != null ? { page, x, y } : null
            others(p.id, { t: 'cursor', id: p.id, ...(p.cursor ?? { page: null }) })
          } else if (m.t === 'timer') {
            // FigJam's timer: anyone sets one for everyone (up to an hour), or stops it (0). The room's own clock keeps
            // when it ends, so each page counts down from what is left, whatever its own clock says.
            const ms = Number.isFinite(m.ms) ? Math.min(3_600_000, Math.max(0, Math.round(m.ms))) : 0
            for (const o of peers.values()) o.timer = null
            p.timer = ms ? { until: now() + ms, by: p.name } : null
            const msg = { t: 'timer', left: ms, by: p.name }
            send(msg)
            others(p.id, msg)
          } else if (m.t === 'spotlight') {
            // Figma's Spotlight: this person asks everyone else to follow them (on), or lets them go (off).
            p.spotlight = !!m.on
            others(p.id, { t: 'spotlight', id: p.id, on: p.spotlight })
          } else if (m.t === 'chat') {
            // Cursor chat, as Figma's: a few words shown by their pointer while they type them (empty takes it away).
            others(p.id, { t: 'chat', id: p.id, text: clean(m.text, 100) })
          } else if (m.t === 'sel') {
            // What they have selected, as boxes on the board (at most 50), for others to outline in their color.
            const page = clean(m.page, 240)
            const boxes = (Array.isArray(m.boxes) ? m.boxes : []).slice(0, 50).map((b) => ({ x: num(b?.x), y: num(b?.y), w: num(b?.w), h: num(b?.h) })).filter((b) => b.x != null && b.y != null && b.w != null && b.h != null && b.w >= 0 && b.h >= 0)
            p.sel = page && boxes.length ? { page, boxes } : null
            others(p.id, { t: 'sel', id: p.id, ...(p.sel ?? { page: null, boxes: [] }) })
          } else if (m.t === 'view') {
            // What they are looking at, for anyone following them: a page, the board point in the middle, the zoom.
            const page = clean(m.page, 240)
            const x = num(m.x)
            const y = num(m.y)
            const z = Number.isFinite(m.z) ? Math.min(64, Math.max(0.01, m.z)) : null
            if (page && x != null && y != null && z != null) others(p.id, { t: 'view', id: p.id, page, x, y, z })
          }
        },
        leave() {
          if (!peers.delete(p.id)) return
          if (p.host) tellHost()
          else if (p.here) others(p.id, { t: 'leave', id: p.id })
        },
      }
    },
  }
}

/** The WebSocket handshake's answer to a browser's key (RFC 6455). */
async function acceptKey(key) {
  const bytes = new TextEncoder().encode(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1', bytes))
  return btoa(String.fromCharCode(...hash))
}

/** One text frame, from the server (unmasked). */
function frame(text, opcode = 1) {
  const body = new TextEncoder().encode(text)
  const n = body.length
  const head = n < 126 ? [0x80 | opcode, n] : n < 65536 ? [0x80 | opcode, 126, n >> 8, n & 255] : null
  if (!head) return null
  const out = new Uint8Array(head.length + n)
  out.set(head, 0)
  out.set(body, head.length)
  return out
}

/** A Node HTTP upgrade to a WebSocket, joined to the room: the browser's frames (masked, as browsers send them)
 *  read, its messages handed to the room, the room's messages sent back. Frames over 64 KB, or in pieces, close it. */
export async function acceptSocket(req, socket, room) {
  const key = req.headers['sec-websocket-key']
  if (!key || req.headers.upgrade?.toLowerCase() !== 'websocket') return socket.destroy()
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${await acceptKey(key)}\r\n\r\n`)
  socket.setNoDelay(true)
  const send = (msg) => {
    const f = frame(JSON.stringify(msg))
    if (f && socket.writable) socket.write(f)
  }
  const me = room.join(send)
  if (!me) return socket.end()
  let buf = new Uint8Array(0)
  const close = () => {
    me.leave()
    if (!socket.destroyed) socket.end()
  }
  socket.on('data', (chunk) => {
    const next = new Uint8Array(buf.length + chunk.length)
    next.set(buf, 0)
    next.set(chunk, buf.length)
    buf = next
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80
      const op = buf[0] & 0x0f
      const masked = buf[1] & 0x80
      let n = buf[1] & 0x7f
      let at = 2
      if (n === 126) {
        if (buf.length < 4) return
        n = (buf[2] << 8) | buf[3]
        at = 4
      } else if (n === 127) return close()
      if (!masked || !fin) return close()
      if (buf.length < at + 4 + n) return
      const mask = buf.subarray(at, at + 4)
      const body = buf.slice(at + 4, at + 4 + n)
      for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3]
      buf = buf.slice(at + 4 + n)
      if (op === 1) me.message(new TextDecoder().decode(body))
      else if (op === 8) return close()
      else if (op === 9) {
        const pong = frame(new TextDecoder().decode(body), 10)
        if (pong && socket.writable) socket.write(pong)
      }
    }
  })
  socket.on('close', () => me.leave())
  socket.on('error', () => me.leave())
}
