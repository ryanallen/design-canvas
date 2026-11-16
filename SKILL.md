---
name: design-canvas
description: Lay a folder of HTML prototypes out on one canvas to view, play, edit and comment on, as HTML and CSS, with every edit written back into the prototype's own file. Use to review prototypes on a board, edit a prototype's text, styles or structure by pointing at it, leave or read comments pinned to elements, or answer comments an agent was asked to act on.
---

# Design canvas

Every `.html` in a folder on one board. Built, it is one self-contained `canvas.html` that opens from disk and fetches nothing. Served, it edits: select an element, retype it, restyle it, move it, group it, comment on it, and the change is written into that prototype's `.html` at the bytes it touches, nothing else.

It works the way HTML and CSS work: the layers are the DOM, the properties are the element's CSS, elements flow the way the browser lays them out, and only an element that is already positioned moves by `left` and `top`.

## Commands

Run from this folder (or give the path to `scripts/canvas.mjs`):

```sh
node scripts/canvas.mjs build  <folder> [--layout canvas.json] [--out canvas.html] [--title t] [--no-measure]
node scripts/canvas.mjs serve  <folder> [the same] [--port 4410]
node scripts/canvas.mjs check  <folder> [--shots <dir>]
node scripts/canvas.mjs accept <folder> <prototype.html>…
```

A person can skip the terminal: **Design Canvas.cmd** (Windows) or **Design Canvas.command** (Mac) asks for the folder and offers build and open, open, check and serve. A built canvas opened from disk in Chrome or Edge edits itself once **Viewing · Edit** is clicked and its folder picked, with no server.

- **build** writes `<folder>/canvas.html`: every prototype inlined, the page's own code inlined, and every comment, edit and board line already in the file kept.
- **serve** builds, then serves it on `http://127.0.0.1:4410/`, reachable from this machine only. Edits go into the prototypes; comment, edit and board lines go into `canvas.html`.
- **check** is the gate: through a real browser it makes each kind of edit, undoes each, leaves and reads back a comment and a sticky note, opens Play, looks at 390 wide, and fails on an error or any request off the machine. Nothing it does is written to disk.
- **accept** says a prototype changed on purpose since its last canvas edit (its build script now carries the edits), so `build` stops refusing it.

Measuring each prototype's height needs a Chromium: `scripts/lib/browser.mjs` finds a Playwright already on the machine (or `CANVAS_PLAYWRIGHT` pointing at a `node_modules` that holds one). Without one, frames are drawn 1440 × 1000 and `check` cannot run.

## What it reads

- **Prototypes**: every `.html` in the folder that is not a `canvas*.html`. A prototype whose screens are `<section class="screen-page" id="…">` is one frame per screen.
- **Layout**: `canvas.json` beside the prototypes, or `--layout`: `{ "title": "…", "pages": [{ "title": "…", "sections": [{ "title": "…", "sub": "…", "groups": [{ "kind": "flat", "frames": [{ "file": "a.html", "hash": "", "label": "a" }] }] }] }] }`. `{ "title", "sections" }` is one page. Group kinds are `flat`, `option` (`letter`, `title`, `info`, `recommended`; the first frame large, the rest under it) and `other`. A frame may carry `crop: "A"` to show one option's column of a comparison board. With no layout, every prototype goes in one grid.
- **Opening on a page**: `canvas.html#page=<id or title>`, such as `#page=summary`, opens on that page, matched without regard to case, ahead of the page last viewed in that browser.
- **Levers**: `<meta name="canvas-levers" content="--accent, --gap">` names the CSS variables shown under Tweaks.
- **Fluid**: `<meta name="canvas-fluid">` marks a prototype that reflows to any width.
- **Where comments go**: `"comments": "<address>"` in `canvas.json`, or `--comments <address>` on build. Served by node, comments go to the server; editing from disk, into `canvas.html` itself; anywhere else, to that address, or to the hosting site's own `/api/canvas-comments` when none is set.

## The lines in `canvas.html`

Everything people do is a line before `</body>`, one JSON event each, never rewritten:

- `<!-- comment {…} -->`: `add` (with `file` and `anchor` when pinned to an element, `agent: true` when it is work for an agent), `reply`, `resolve`, `delete`, `agent`.
- `<!-- edit {…} -->`: who, when, the file, the change in words, and a fingerprint of the file after it. The exact change is the file's own diff.
- `<!-- board {…} -->`: notes, titles, shapes, guides, pages, frames moved by hand, the canvas's own name.

`build` refuses a prototype whose file no longer matches its last edit line, so a rebuild by its own script never drops a canvas edit silently: carry the edits into the script, then `accept`.

## Working with an agent

From disk, an agent reads the threads straight from `canvas.html`: `parseEvents` and `foldEvents` in `scripts/lib/events.mjs` fold its comment lines, and a thread with `agent: true` is work for it. While `serve` runs, the same is answered over HTTP:

- `GET /api/selection`: what is selected on the board: `file`, `cvs` (source offsets) and each element's source HTML.
- `GET /api/agent`: every open thread marked for the agent, with its file, its anchor and its replies.
- To answer one: edit the prototype's file (the canvas reloads its frames on its own), then reply on the thread with `POST /api/canvas-comments` and `{ "event": { "op": "reply", "to": "<thread id>", "name": "agent", "text": "…" } }`; resolve it with `{ "op": "resolve", "to": "<id>", "name": "agent" }`.


## Sharing

`canvas.html` is the thing shared: send it or put it on any static host. A host that should take comments answers `GET ?path=<page>` with `{ events }` and `POST { path, event }` with `{ event }`, writing the posted line into the file, at `/api/canvas-comments` on its own site or at the address set with `comments`. A host on another site is called with its cookies (`credentials: include`), so it allows the canvas's origin.
