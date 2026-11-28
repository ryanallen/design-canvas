# Hosting a canvas

A built `canvas.html` is one file that fetches nothing, so any static host shows it. What else people can do with it depends on where it lives and what answers it there. This repository is public, so it holds no keys, tokens or private addresses, and none should ever go in. A host's secrets live in that host's own secret store.

## The ways, side by side

| Where it lives | Who edits | What is shared between people | Who is the owner |
| --- | --- | --- | --- |
| Served by node on your machine (`canvas.mjs serve`) | You, and anyone at `127.0.0.1` | Everything, written into the folder | You |
| Opened from disk in Chrome or Edge, Edit on | You | Everything, written into the folder | You |
| Any static host, built with `"play": true` | Every visitor | Nothing. Each visitor's changes stay in their own browser | Nobody there. You are, in your own copy |
| Any static host, with a comments endpoint | Nobody edits. Everyone can comment | Comments | Whoever the endpoint says |

## A static host, in play mode

This repository's own page works this way: GitHub Pages serves `index.html` from `main`, built from `site/`.

1. Put `"play": true` in the folder's `canvas.json`, and any `"links"` for the top bar.
2. `node scripts/canvas.mjs build <folder> --out index.html`
3. Publish `index.html` anywhere: GitHub Pages (Settings → Pages → Deploy from a branch), Cloudflare Pages, Netlify, an S3 bucket.

Visitors edit, draw and comment, and it is all kept in their browser (localStorage) and seen by nobody else. No server, no keys, nothing to moderate.

## Locks

Lock what people need to see as you left it. A locked artboard or board object is not moved, changed or removed until it is unlocked, and a visitor puts nothing new over it. A locked part of an artboard (an element carrying `data-locked`, and everything in it) is not changed, moved, removed or wrapped, and nothing holding it is retyped or removed. Visitors answer your comments but do not delete or resolve them.

Only the owner can lock and unlock. The owner is whoever edits where the canvas lives, either served by node or from its folder on disk.

- **An artboard**: the padlock in its header.
- **A board object**: pick it, then Lock in its bar. A drag box locks or unlocks everything in it at once.
- **A part of an artboard**: select it, then the padlock in its floating toolbar.
- **By key**: Ctrl+Shift+L (⌘+Shift+L) locks what is selected, a part or board objects, and unlocks it when it is all locked, as in Figma.

Then build and publish again. The locks travel in the file. Board locks are saved as `lock` lines, and part locks as `data-locked` in the artboard's own HTML.

In play mode the page itself holds visitors to the locks. A visitor who changes the page's code in their own browser changes only their own copy, which nobody else sees. A shared host has to hold everyone to them on its own side (below).

## Shared comments on a host

A canvas built with `"comments": "<address>"` in `canvas.json` (or `--comments <address>`), or opened on a site that answers `/api/canvas-comments` itself, sends comments there:

- `GET <address>?path=<page>` answers `{ "events": [ … ] }`
- `POST <address>` with `{ "path": "<page>", "event": { … } }` stores the line and answers `{ "event": { … } }`

A host on another site is called with cookies (`credentials: include`), so it answers with `Access-Control-Allow-Origin` set to the canvas's own origin (not `*`) and `Access-Control-Allow-Credentials: true`.

### With a Cloudflare Worker

A Worker and a KV namespace (or D1) answer those two calls. `scripts/lib/events.mjs` imports nothing, so the Worker uses its `makeEvent` to check and stamp each line exactly as the canvas does.

- **Identity**: the Worker sets a signed, HTTP-only cookie with a random visitor id on first visit, and stamps each line with it.
- **The owner**: put the Worker's admin paths behind Cloudflare Access (Zero Trust → Access → an application on that path, allowing your own email). The Worker reads the `Cf-Access-Authenticated-User-Email` header Access adds and trusts nothing else.
- **Moderation**: when the owner deletes a line, it's hidden. A shadow-banned visitor's lines are stored but shown only to that visitor.
- **Abuse**: a cap on lines per visitor and per IP each minute, a cap on each line's size, and Turnstile on the first post.
- **Secrets**: the cookie-signing key and the Turnstile secret go in with `wrangler secret put <NAME>`, and locally in `.dev.vars`, which `.gitignore` keeps out of git. `wrangler.toml` holds names and bindings only.

### With GitHub sign-in

To make "the owner" whoever has write access to a repository, use a GitHub OAuth app (Settings → Developer settings → OAuth Apps) with its callback on the Worker. The Worker trades the code for a token, asks `GET /repos/<owner>/<repo>/collaborators/<login>/permission`, and keeps only the login and the answer in its signed cookie. The client secret goes in with `wrangler secret put GITHUB_CLIENT_SECRET`, and the client id is a plain variable.

### Locks on a shared host

A shared host refuses, for anyone but the owner:

- a `lock` line;
- an `item`, `remove` or `move` line whose id or key is locked (`foldBoard(lines).locked`);
- an edit for which `lockedFor(src, edit)` from `scripts/lib/html.mjs` gives a reason. It imports nothing, so the Worker uses it as is.

## Seeing each other on a host

A served canvas already shows everyone's pointer and face. To get the same on a hosted copy, run the room in `worker/` on Cloudflare's free Workers plan and point the canvas at it.

1. Sign in once with `npx wrangler login`, which opens Cloudflare in your browser. A free account is enough.
2. In `worker/wrangler.toml`, set `ALLOWED_ORIGINS` to the pages that may join, such as `"https://ryanallen.com"`. Leave it empty to let any page join.
3. From `worker/`, run `npx wrangler deploy`. It prints the Worker's address, such as `https://design-canvas-room.<you>.workers.dev`.
4. Put `"room": "wss://design-canvas-room.<you>.workers.dev/room/<room id>"` in the folder's `canvas.json`. The room id is any 8 to 64 letters, digits, `-` or `_`, one per canvas. A long random one keeps strangers out of it.
5. Build and publish again.

Everyone who opens that canvas, hosted or served, then joins the same room. The room is a Durable Object that runs `scripts/lib/room.mjs`, the same code as the local server's room. It sleeps between messages, so an idle room costs nothing. The free plan allows 100,000 requests a day, and each person's pointer counts as one request per 20 updates. To try it on your own machine first, run `npx wrangler dev --port 8799` in `worker/` and use `ws://127.0.0.1:8799/room/<room id>`.

## Editing together through the room

People you invite can edit your prototypes live from the hosted copy, while your canvas is running.

1. Make an owner key, a long random string, and give it to the room: `npx wrangler secret put OWNER_KEY` in `worker/`.
2. Put the same key in a file named `.room-key` beside the prototypes (`.gitignore` keeps it out of git), or in the `DC_ROOM_KEY` environment variable.
3. Serve the folder as usual: `node scripts/canvas.mjs serve <folder>`. It joins the room as its host and prints the invite key.
4. Put the hosted copy's address in `canvas.json` as `"url"`. Then **Copy invite link** in your canvas's menu (on its title) copies that address with `#invite=<key>` at the end. Without `url`, add `#invite=<key>` to the address yourself. Send people the link. The page takes the key out of its address once read, so a link copied from there doesn't pass it on.

Their edits, comments and board changes go through the room to your server, which checks each one as it checks your own and writes it into your folder. Your changes show on their pages the same way. They can't make new files or screens, take pictures of screens, fetch fonts, or reach the agent's endpoints. The invite key is worked out from the owner key and the room address, so a new owner key makes a new invite key. When your canvas isn't running, their page says the owner is offline, and changes wait until it's back. Visitors without the key edit only their own copy, as in play mode.

## What a host does not share yet

Pointers and faces travel through a room, edits too for people with the invite key, and comments through a comments endpoint. Board objects and prototype edits are shared between people only where the canvas lives, either served by node or in its folder. On a host they stay read-only, or, in play mode, private to each visitor.
