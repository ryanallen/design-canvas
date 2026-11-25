---
name: design-canvas
description: Lay a folder of HTML prototypes out on one canvas to view, play, edit and comment on, as HTML and CSS, with every edit written back into the prototype's own file. Use to review prototypes on a board, edit a prototype's text, styles or structure by pointing at it, leave or read comments pinned to elements, or answer comments an agent was asked to act on.
---

# Design canvas

Every `.html` in a folder on one board. Built, it is one self-contained `canvas.html` that opens from disk and fetches nothing. Served, it edits: select an element, retype it, restyle it, move it, group it, comment on it, and the change is written into that prototype's `.html` at the bytes it touches, nothing else.

It works the way HTML and CSS work: the layers are the DOM, the properties are the element's CSS, elements flow the way the browser lays them out, and only an element that is already positioned moves by `left` and `top`.

On the board, a plain click on a link, button, checkbox or field inside an artboard works it: a link to the web opens in a new tab, a link to another artboard goes to it on the board, a `#` link moves within the artboard. Ctrl or ⌘ + click (or Shift, or Alt) selects it instead, to edit it. A click selects the one element clicked, and a style goes on that element alone; With an element selected, holding Alt over another shows the distance between them in the prototype's own pixels (each side, when one holds the other). Alt + click, or **Select every copy** under the toolbar's …, selects every copy of it (the same tag and classes under the same kind of parent), and a style then goes into a rule they all follow.

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
- **Levers**: `<meta name="canvas-levers" content="--accent, --gap">` names the CSS variables shown under Tweaks. A colour gets a picker that keeps its alpha; a number gets a slider sized to its unit (0 to 1 in hundredths for a bare fraction, below zero for a negative) and a field for an exact value. A change is written where the prototype's `:root` declares the variable, so the file keeps one value for it.
- **Fluid**: `<meta name="canvas-fluid">` marks a prototype that reflows to any width.
- **Width**: `<meta name="canvas-width" content="390">` draws a prototype that wide on the board (240 to 3840), measured for its height at that width; without it, 1440. The artboard tool (A) shows Desktop 1440, Laptop 1280, Tablet 834 and Phone 390: a click on the board makes a new prototype of the size chosen, a drag any size, and one not 1440 wide carries this tag. The width on a screen's label (served) changes it for a prototype already there: Desktop, Laptop, Tablet, Phone or a custom width, written as this tag in one edit that Ctrl+Z takes back; the board draws every frame of that file at the new width and measures its height there, and follows the tag whenever the file changes, by an undo or an agent.
- **Where comments go**: `"comments": "<address>"` in `canvas.json`, or `--comments <address>` on build. Served by node, comments go to the server; editing from disk, into `canvas.html` itself; anywhere else, to that address, or to the hosting site's own `/api/canvas-comments` when none is set.
- **Play**: `"play": true` in `canvas.json` makes the canvas, opened from any website, edit for every visitor with nothing to pick: edits, board objects, artboards and comments are kept in that visitor's browser (localStorage) and seen by nobody else.
- **Links**: `"links": [{ "text": "★ Star", "href": "https://…" }]` in `canvas.json` puts those links at the right of the top bar.

## The lines in `canvas.html`

Everything people do is a line before `</body>`, one JSON event each, never rewritten:

- `<!-- comment {…} -->`: `add` (with `file` and `anchor` when pinned to an element, `box` and `items` when it is about a region of the board, `agent: true` when it is work for an agent), `reply`, `resolve`, `delete`, `agent`.
- `<!-- edit {…} -->`: who, when, the file, the change in words, and a fingerprint of the file after it. The exact change is the file's own diff.
- `<!-- board {…} -->`: notes, titles, rectangles and ellipses (each with its own text), sections, lines, arrows, pencil strokes, guides, groups (objects sharing a `group` id), stacking order (`z`), pages, frames moved by hand, the canvas's own name. A line or arrow with `from` and `to` (a board object's id or a frame's key) is drawn between those two wherever they move; an empty `from` or `to` lets go.

## Typing in place

Enter (or double-click) on a selected text element types in it. Enter while typing goes on in a new element after it, as a text editor does: the same tag and attributes but the id (a paragraph after a heading), never a `<div>` inside the paragraph. Shift+Enter is a line break inside it; Escape, or Enter in a one-line element, ends typing. Everything typed, however many elements Enter made, is one edit for Ctrl+Z.

## Flows

**Show flows on the board**, at the top of the Play menu, draws an arrow from each link in a screen to the screen on the page it opens (a link to `other.html` or `other.html#screen`), as Figma draws prototype connections: up from the link, over the tops of the screens, onto the top edge of the one it opens. Kept in that browser until **Hide flows**.

## Layers

The panel's Layers list the page's board objects and frames, and an open frame's elements, each named by its `data-name` or `aria-label`, else what it is and what it says. Served, a layer dragged onto another goes before it or after it (by the half it is dropped on), or inside it on the middle of one that holds others: one move in the file. Double-click names a layer, written as `data-name` (empty takes it off). The eye on a layer hides it, as `display: none` on the element so Play hides it too, and shows it again; a hidden layer's row is dimmed.

## Copy and paste

Ctrl+C in a prototype copies every element selected, in page order, as its file has it; Ctrl+V puts them after the element selected (inside it for the page's body). Pasted into the same prototype they stay plain markup, styled by its classes. Pasted into another prototype, whose stylesheet has none of those rules, each part carries its look on itself (colours, type, spacing, corners, shadows, layout; never its width or height, so it fits where it lands). An `id` already on the page gets a new one.

## Code tab

The **Code** tab shows the element's own style (editable), then each rule that matches it, strongest first as the cascade ranks them (`!important`, specificity, then order in the file), with every declaration a stronger one overrides struck through, so the value shown unstruck is the one that applies. Then its attributes, what it inherits and from which ancestor, and its source.

## States

Properties has **Default · Hover · Pressed · Focus** above an element's properties. In a state, the element is shown on the board as it looks in that state (every `:hover`, `:active` or `:focus` rule for it applied, the prototype's own and the canvas's), Properties reads those values, and a change is written as that state's rule for the element's id, or else its tag and classes, so Play shows it for real. An element with neither is asked for one. **Motion** (None, Quick, Smooth, Slow) sets how fast it changes into a state and back: a CSS `transition` on the element itself. **Entrance** (Fade, Rise, Pop, Slide, Bounce with a middle keyframe past its place, or Custom: its own first keyframe, from start opacity, scale, turn and X · Y to its resting look, with a middle keyframe at 60% of its own X · Y and scale when Middle is on) is how it comes in when the page opens, with a speed (Quick 250, Smooth 450, Slow 800 ms) and a delay in ms to stagger it after what is above it; ▷ plays it again on the board, and Scrub holds it at any moment of it. Leaving Custom takes its own `@keyframes` out of the file. **Stagger** (with two or more siblings of its tag and class, such as a row of cards) gives them all the same entrance, each 60, 120 or 200 ms after the one before, in one edit (the `styles` edit: several elements' own styles at once); Off leaves it on this one alone. ▷ plays every entrance on the screen again. It is an `animation` on the element and the `@keyframes` it names, which the same edit writes into one `<style data-canvas-keyframes>` in the head, so Play and the file shown anywhere run it. Properties reads an element's resting look, never a frame of its entrance.

## Find and replace

Ctrl+F opens Find: it counts the words wherever they appear in the text of the page's artboards and its board objects, any case; Enter and Shift+Enter step through them, each selected and zoomed to. **Replace all** puts the new words in every place, through `replaceText` in `scripts/lib/html.mjs`, which changes only text between tags (never a tag, an attribute, a comment, a script, a style or a locked part); Ctrl+Z takes it back.

## Components

**Make component…** under the toolbar's … (Ctrl+Alt+K) names the selected element a component: it carries `data-component="Name"`, and every element of that name in the file is a copy of it. Duplicate one to make another. A style, an attribute, or a part added, duplicated or removed anywhere inside one copy is made at the same place in every copy, and the toolbar says so; text typed into a copy, markup replaced whole in the Code tab, and a copy's `id` stay that copy's own, as does anything in a locked part. The toolbar shows **◇ Name · n** inside a copy (a click selects the copy whole), **Select all n Name** selects every copy, and **Detach from component** makes one copy a plain element again. **Make a variant…** gives a copy a variant name (`data-variant`, as Figma's variants): a style or attribute changed on it then reaches only copies of that variant, while parts added or removed still reach every copy, and the toolbar shows **◇ Name / Variant · n**. `applyEdit` in `scripts/lib/html.mjs` makes the change in every copy, so an agent's edits through `/api/edit` reach them all too.

## The whiteboard

Every page is a whiteboard, with or without prototypes on it. Sticky note (N), text (T), pencil (P), and under the shape button rectangle (R), ellipse, section (S), line, arrow and layout guide. Double-click a note, a rectangle, an ellipse or a section to type in it. A title's bar sets its size: S, M, L or XL. A section is a labelled area drawn under everything else: dragged by its label or its border, it carries every object and frame wholly inside it, and a drag anywhere else inside it draws a selection box. Ctrl+Z undoes and Ctrl+Shift+Z (or Ctrl+Y) redoes whatever was done last, on the board or in a prototype, in one history: a board step is everything one action changed (a group dragged, an align, a paste), put back as it was. Ctrl+] brings the objects selected to the front and Ctrl+[ sends them to the back (a `z` on their board lines). Shift+2 zooms to what is selected, on the board or in a prototype, and Shift+1 to everything. A board object dragged catches its edges and centre on those of other objects and frames it passes, with the line it caught on drawn; Ctrl or ⌘ held lets it go anywhere. A line or arrow begun or ended on a note, shape, section or frame holds on to it and follows it; dragging the line itself lets go. While editing, a drag from empty board with the select tool draws a selection box, Shift + click adds an object to the selection or takes it out, and Ctrl+A chooses every object and frame on the page (in a prototype, everything alongside the selected element): what is selected moves together, takes one colour from its bar, Delete removes its board objects, **Group** (Ctrl+G) makes them one group that a click on any of them picks whole and that moves, colours and deletes as one until **Ungroup** (Ctrl+Shift+G), **Align** lines them up by an edge or centre or spaces three or more evenly (Figma's keys: Alt+A, H, D, W, V, S, and Alt+Shift+H or V), Ctrl+D duplicates, Alt + drag places a copy where the drag ends, and Ctrl+C, Ctrl+V copy and paste (a line copied with both the objects it holds holds the copies), **Page** on the bar moves what is selected to another page at the same spot, and **✦ Ask agent** leaves the agent a thread carrying the box and everything in it. Served, every open copy of the canvas redraws when anyone changes the board.

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
