// The hosted room: a Cloudflare Worker with one Durable Object per canvas, so people opening the same canvas from
// anywhere see each other's pointers. It runs the room in scripts/lib/room.mjs, the same code the local server
// does. The object hibernates between messages (free while idle); each socket keeps its person's state, and the
// room is made again from those on every message.
//
//   wss://<your worker>/room/<room id>     the room id is any 8 to 64 letters, digits, - or _: one per canvas
//
// ALLOWED_ORIGINS (in wrangler.toml) lists the pages that may join, comma-separated, such as
// "https://ryanallen.com,http://127.0.0.1:4410". Empty lets any page join.
import { makeRoom } from '../scripts/lib/room.mjs'

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    const m = /^\/room\/([A-Za-z0-9_-]{8,64})$/.exec(url.pathname)
    if (!m) return new Response('This is a design-canvas room. Join one at /room/<room id> over a WebSocket.', { status: 404 })
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('A room is joined over a WebSocket.', { status: 426 })
    const allowed = String(env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    if (allowed.length && !allowed.includes(req.headers.get('origin'))) return new Response('This page may not join the room.', { status: 403 })
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req)
  },
}

export class Room {
  constructor(ctx) {
    this.ctx = ctx
  }

  /** The room as its sockets keep it, each person's handle by socket. */
  room() {
    const room = makeRoom()
    const handles = new Map()
    for (const ws of this.ctx.getWebSockets()) {
      const state = ws.deserializeAttachment()
      if (state) handles.set(ws, room.join(sender(ws), state))
    }
    return { room, handles }
  }

  async fetch() {
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    const { room } = this.room()
    const me = room.join(sender(server))
    if (!me) server.close(1013, 'The room is full')
    else server.serializeAttachment(me.state)
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws, text) {
    if (typeof text !== 'string') return
    const me = this.room().handles.get(ws)
    if (!me) return
    me.message(text)
    ws.serializeAttachment(me.state)
  }

  async webSocketClose(ws) {
    this.room().handles.get(ws)?.leave()
    ws.serializeAttachment(null)
    try { ws.close() } catch {}
  }

  async webSocketError(ws) {
    return this.webSocketClose(ws)
  }
}

const sender = (ws) => (msg) => {
  try { ws.send(JSON.stringify(msg)) } catch {}
}
