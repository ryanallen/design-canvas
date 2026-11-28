// The owner's canvas in a hosted room: `serve` joins the room named in canvas.json as its host when DC_ROOM_KEY (the
// room Worker's OWNER_KEY) is set. Guests who opened the hosted canvas with the invite key send their /api/ calls
// through the room; each is answered by the same request made to this server, so everything the server checks for
// its own page it checks for them. Only the calls an editor needs are taken. What the server tells its own pages
// (a file changed, new lines, the board) goes to the room too.
import { createHmac } from 'node:crypto'

/** The calls a guest may make, by method. Not: making files or screens, pictures of screens, fonts fetched from the
 *  web, the agent's endpoints, or the whole canvas. */
export const GUEST_CALLS = {
  GET: ['/api/file', '/api/board', '/api/canvas-comments', '/api/history', '/api/source'],
  POST: ['/api/edit', '/api/undo', '/api/redo', '/api/board', '/api/canvas-comments', '/api/sheet'],
}
// An answer's body in parts of this many characters: well under the 1 MB a Cloudflare WebSocket message may be,
// even once JSON has escaped every quote and line break in a prototype's HTML.
const PART = 300_000

/** The invite key for a room: the same every time for one owner key and one room, so nothing has to be stored. */
export const inviteKey = (ownerKey, room) => createHmac('sha256', ownerKey).update(room).digest('base64url').slice(0, 24)

/** Join `room` as its host, answering guests' calls against this server at `base`. */
export function hostRoom({ room, ownerKey, base, log = () => {} }) {
  const editKey = inviteKey(ownerKey, room)
  let ws = null
  let tries = 0
  let closed = false
  let said = false
  const send = (m) => {
    if (ws?.readyState === 1) ws.send(JSON.stringify(m))
  }
  async function answer(m) {
    let status = 403
    let body = JSON.stringify({ error: "That isn't something a guest can do." })
    let u = null
    try { u = new URL(String(m.path ?? ''), base) } catch {}
    if (u && u.origin === new URL(base).origin && GUEST_CALLS[m.method]?.includes(u.pathname)) {
      try {
        const res = await fetch(new URL(u.pathname + u.search, base), {
          method: m.method,
          headers: { origin: base, 'content-type': 'application/json' },
          body: m.method === 'POST' ? (typeof m.body === 'string' ? m.body : '') : undefined,
        })
        status = res.status
        body = await res.text()
      } catch (err) {
        status = 502
        body = JSON.stringify({ error: err.message })
      }
    }
    const of = Math.max(1, Math.ceil(body.length / PART))
    for (let i = 0; i < of; i++) send({ t: 'answer', to: m.from, n: m.n, status, part: i, of, body: body.slice(i * PART, (i + 1) * PART) })
  }
  function connect() {
    if (closed) return
    ws = new WebSocket(room)
    ws.onopen = () => {
      tries = 0
      send({ t: 'hello', host: true, key: ownerKey, editKey })
    }
    ws.onmessage = (e) => {
      let m
      try { m = JSON.parse(e.data) } catch { return }
      if (m.t === 'call') answer(m)
      else if (m.t === 'welcome' && m.host && !said) {
        said = true
        log(`Joined the room as its host. People who open the canvas with #invite=${editKey} at the end of its address can edit it.`)
      } else if (m.t === 'refused') log(`The room refused this canvas as its host: ${m.error} Check DC_ROOM_KEY against the Worker's OWNER_KEY.`)
    }
    ws.onerror = () => {}
    ws.onclose = () => {
      if (!closed) setTimeout(connect, Math.min(30000, 1000 * 2 ** tries++))
    }
  }
  connect()
  return {
    editKey,
    tell: (event, data) => send({ t: 'tell', event, data }),
    close() {
      closed = true
      try { ws?.close() } catch {}
    },
  }
}
