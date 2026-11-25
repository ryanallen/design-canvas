---
name: design-canvas
description: Lay a folder of HTML prototypes out on one canvas to view, play, edit and comment on, as HTML and CSS, with every edit written back into the prototype's own file. Use to review prototypes on a board, edit a prototype's text, styles or structure by pointing at it, leave or read comments pinned to elements, or answer comments an agent was asked to act on.
---

# Design canvas

Every `.html` in a folder on one board. Built, it is one self-contained `canvas.html` that opens from disk and fetches nothing. Served, it edits: select an element, retype it, restyle it, move it, group it, comment on it, and the change is written into that prototype's `.html` at the bytes it touches, nothing else.

It works the way HTML and CSS work: the layers are the DOM, the properties are the element's CSS, elements flow the way the browser lays them out, and only an element that is already positioned moves by `left` and `top`.

On the board, a plain click on a link, button, checkbox or field inside an artboard works it: a link to the web opens in a new tab, a link to another artboard goes to it on the board, a `#` link moves within the artboard. Ctrl or ⌘ + click (or Shift, or Alt) selects it instead, to edit it. A click selects the one element clicked, and a style goes on that element alone; Alt + click, or **Select every copy** under the toolbar's …, selects every copy of it (the same tag and classes under the same kind of parent), and a style then goes into a rule they all follow.

On a phone or tablet, one finger drags the board with any tool that does not draw, two fingers pinch to zoom, and a tap does what a click does. On a narrow screen the layout's links are in the canvas menu under the title, and a comment thread opens over the bottom of the screen.

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
- **serve** builds, then serves it on `http://127.0.0.1:4410/` (the next free port if that one is taken; a `--port` named is used or refused), reachable from this machine only. Edits go into the prototypes; comment, edit and board lines go into `canvas.html`. Each file is written whole or not at all (a hidden file beside it, renamed over it), so a crash or a full disk leaves a prototype or `canvas.html` as it was.
- **check** is the gate: through a real browser it makes each kind of edit, undoes each, leaves and reads back a comment and a sticky note, opens Play, looks at 390 wide, and fails on an error or any request off the machine. Nothing it does is written to disk.
- **accept** says a prototype changed on purpose since its last canvas edit (its build script now carries the edits), so `build` stops refusing it.

Measuring each prototype's height needs a Chromium: `scripts/lib/browser.mjs` finds a Playwright already on the machine (or `CANVAS_PLAYWRIGHT` pointing at a `node_modules` that holds one). Without one, frames are drawn 1440 × 1000 and `check` cannot run.

## What it reads

- **Prototypes**: every `.html` in the folder that is not a `canvas*.html`. A prototype whose screens are `<section class="screen-page" id="…">` is one frame per screen. A folder with none, or one that does not exist yet, builds as a **whiteboard**: one empty page named Board.
- **Layout**: `canvas.json` beside the prototypes, or `--layout`: `{ "title": "…", "pages": [{ "title": "…", "sections": [{ "title": "…", "sub": "…", "groups": [{ "kind": "flat", "frames": [{ "file": "a.html", "hash": "", "label": "a" }] }] }] }] }`. `{ "title", "sections" }` is one page. Group kinds are `flat`, `option` (`letter`, `title`, `info`, `recommended`; the first frame large, the rest under it) and `other`. A frame may carry `crop: "A"` to show one option's column of a comparison board. With no layout, every prototype goes in one grid.
- **Opening on a page**: `canvas.html#page=<id or title>`, such as `#page=summary`, opens on that page, matched without regard to case, ahead of the page last viewed in that browser.
- **Levers**: `<meta name="canvas-levers" content="--accent, --gap">` names the CSS variables shown under Tweaks.
- **Fluid**: `<meta name="canvas-fluid">` marks a prototype that reflows to any width.
- **Where comments go**: `"comments": "<address>"` in `canvas.json`, or `--comments <address>` on build. Served by node, comments go to the server; editing from disk, into `canvas.html` itself; anywhere else, to that address, or to the hosting site's own `/api/canvas-comments` when none is set.
- **Play**: `"play": true` in `canvas.json` makes the canvas, opened from any website, edit for every visitor with nothing to pick: edits, board objects, artboards and comments are kept in that visitor's browser (localStorage) and seen by nobody else.
- **Links**: `"links": [{ "text": "★ Star", "href": "https://…" }]` in `canvas.json` puts those links at the right of the top bar.

## The lines in `canvas.html`

Everything people do is a line before `</body>`, one JSON event each, never rewritten:

- `<!-- comment {…} -->`: `add` (with `file` and `anchor` when pinned to an element, `box` and `items` when it is about a region of the board, `agent: true` when it is work for an agent), `reply`, `resolve`, `delete`, `agent`.
- `<!-- edit {…} -->`: who, when, the file, the change in words, and a fingerprint of the file after it. The exact change is the file's own diff.
- `<!-- board {…} -->`: notes, titles, rectangles and ellipses (each with its own text), sections, lines, arrows, pencil strokes, guides, groups (objects sharing a  id), pages, frames moved by hand, the canvas's own name. A line or arrow with `from` and `to` (a board object's id or a frame's key) is drawn between those two wherever they move; an empty `from` or `to` lets go.

## The whiteboard

Every page is a whiteboard, with or without prototypes on it. Sticky note (N), text (T), pencil (P), and under the shape button rectangle (R), ellipse, section (S), line, arrow and layout guide. Double-click a note, a rectangle, an ellipse or a section to type in it. A section is a labelled area drawn under everything else: dragged by its label or its border, it carries every object and frame wholly inside it, and a drag anywhere else inside it draws a selection box. A line or arrow begun or ended on a note, shape, section or frame holds on to it and follows it; dragging the line itself lets go. While editing, a drag from empty board with the select tool draws a selection box, and Shift + click adds an object to the selection or takes it out: what is selected moves together, takes one colour from its bar, Delete removes its board objects, **Group** (Ctrl+G) makes them one group that a click on any of them picks whole and that moves, colours and deletes as one until **Ungroup** (Ctrl+Shift+G), and **✦ Ask agent** leaves the agent a thread carrying the box and everything in it. Served, every open copy of the canvas redraws when anyone changes the board.

`build` refuses a prototype whose file no longer matches its last edit line, so a rebuild by its own script never drops a canvas edit silently: carry the edits into the script, then `accept`.

## Working with an agent

From disk, an agent reads the threads straight from `canvas.html`: `parseEvents` and `foldEvents` in `scripts/lib/events.mjs` fold its comment lines, and a thread with `agent: true` is work for it. While `serve` runs, the same is answered over HTTP:

- `GET /api/selection`: what is selected on the board: `file`, `cvs` (source offsets) and each element's source HTML; or, after a selection box, `board` with its `page`, `box`, the board objects inside it in full and the keys of the frames inside it.
- `GET /api/agent`: every open thread marked for the agent, with its file, its anchor (or its `box` and `items`) and its replies.
- `GET /api/board`: every board line, and `board`, the lines folded: `items`, `moved`, `pages`, `name`. To change the board, `POST /api/board` with `{ "event": { "op": "item", "kind": "note", "x": 0, "y": 0, "w": 360, "h": 260, "text": "…", "page": "p1", "name": "agent" } }` (an `id` updates that object), `{ "op": "remove", "id": "…" }`, or `{ "op": "move", "key": "<frame>", "x": …, "y": … }`.
- To answer one: edit the prototype's file (the canvas reloads its frames on its own), then reply on the thread with `POST /api/canvas-comments` and `{ "event": { "op": "reply", "to": "<thread id>", "name": "agent", "text": "…" } }`; resolve it with `{ "op": "resolve", "to": "<id>", "name": "agent" }`.


## Sharing

`canvas.html` is the thing shared: send it or put it on any static host. A host that should take comments answers `GET ?path=<page>` with `{ events }` and `POST { path, event }` with `{ event }`, writing the posted line into the file, at `/api/canvas-comments` on its own site or at the address set with `comments`. A host on another site is called with its cookies (`credentials: include`), so it allows the canvas's origin. [HOSTING.md](HOSTING.md) walks through each way.

## Locks

The owner (whoever edits where the canvas lives: served by node, or its folder on disk) locks what others must leave as it is: an artboard by the padlock in its header, a board object by Lock in its bar or a drag box's bar, a part of an artboard by the padlock in its floating toolbar. A locked artboard or object is not moved, changed or removed until unlocked, and a play-mode visitor puts nothing new over it. A locked part (`data-locked` on an element, and everything in it) is not changed, moved, removed or wrapped, and nothing holding it is retyped or removed. Board locks are `<!-- board {"op":"lock","key":…,"locked":true} -->` lines; part locks are in the prototype's own HTML. `lockedFor(src, edit, { owner })` in `scripts/lib/html.mjs` says why an edit is refused.
