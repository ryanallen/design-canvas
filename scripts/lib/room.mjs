// A room: everyone with the canvas open sees who else is there and where their pointer is. The room logic imports
// nothing, so a Cloudflare Worker's Durable Object runs the same code the local server does; the local server
// speaks WebSocket to the browsers through `acceptSocket`, written here without any package.

/** The colors people are given in a room, in turn: each readable under white text. */
export const ROOM_COLORS = ['#e5484d', '#0091ff', '#30a46c', '#f76b15', '#8e4ec6', '#d6409f', '#12a594', '#ab6400']
const MAX_PEERS = 50
const MAX_MESSAGE = 2048

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max)
const num = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null)

/** A room's people. `join(send)` takes a function that sends one message (an object) to that person, and answers
 *  with what to do with each message they send and when they leave, and `state`, what to keep of them. A host that
 *  sleeps between messages (a Durable Object hibernating) keeps each `state` and hands it back with `join(send, state)`
 *  to make the room as it was. */
export function makeRoom({ newId = () => Math.random().toString(36).slice(2, 10) } = {}) {
  const peers = new Map()
  // The first color nobody here has, so two people never share one while there are colors to go round.
  const nextColor = () => ROOM_COLORS.find((c) => ![...peers.values()].some((p) => p.color === c)) ?? ROOM_COLORS[peers.size % ROOM_COLORS.length]
  const others = (id, msg) => {
    for (const p of peers.values()) if (p.id !== id && p.here) p.send(msg)
  }
  const shown = (p) => ({ id: p.id, name: p.name, color: p.color, ...(p.cursor ? { cursor: p.cursor } : {}) })
  return {
    get size() { return peers.size },
    join(send, state = null) {
      if (!state && peers.size >= MAX_PEERS) {
        send({ t: 'full' })
        return null
      }
      const p = state ? { ...state, send } : { id: newId(), name: '', color: nextColor(), cursor: null, send, here: false }
      peers.set(p.id, p)
      return {
        id: p.id,
        get state() { return { id: p.id, name: p.name, color: p.color, cursor: p.cursor, here: p.here } },
        message(text) {
          if (typeof text !== 'string' || text.length > MAX_MESSAGE) return
          let m
          try { m = JSON.parse(text) } catch { return }
          if (!m || typeof m !== 'object') return
          if (m.t === 'hello') {
            p.name = clean(m.name, 80) || 'Someone'
            send({ t: 'welcome', id: p.id, color: p.color, peers: [...peers.values()].filter((o) => o.id !== p.id && o.here).map(shown) })
            if (!p.here) others(p.id, { t: 'join', ...shown(p) })
            p.here = true
          } else if (!p.here) {
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
          }
        },
        leave() {
          if (!peers.delete(p.id)) return
          if (p.here) others(p.id, { t: 'leave', id: p.id })
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
