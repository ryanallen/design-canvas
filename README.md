# design-canvas

A skill that lays any folder of HTML prototypes out on one board, to view, play, edit and comment on them as HTML and CSS, with every edit written back into the prototype's own `.html`. Every page is also a whiteboard (notes, shapes with text, sections, arrows that stay attached, a selection box to ask an agent about), and a folder with no prototypes builds as a whiteboard alone. Node only: nothing to install, no build step, nothing fetched by the canvas.

## Install

Clone or copy this folder into a project's `.agents/skills/design-canvas/` (or `.claude/skills/design-canvas/`). [SKILL.md](SKILL.md) is what an agent reads.

## Use

Double-click **Design Canvas.cmd** (Windows) or **Design Canvas.command** (Mac). It asks for the folder of prototypes in the system's folder picker, then offers: build the canvas and open it, open it as it is, check it, or serve it. A built `canvas.html` opened in Chrome or Edge edits itself: click **Viewing · Edit** at the top and pick its folder once; nothing is left running. Both need [Node](https://nodejs.org) installed.

The same from a terminal:

```sh
node scripts/canvas.mjs build  <folder>   # canvas.html beside the prototypes, opens from disk
node scripts/canvas.mjs serve  <folder>   # http://127.0.0.1:4410/ (or the next free port), edit and comment
node scripts/canvas.mjs check  <folder>   # the gate
node scripts/canvas.mjs accept <folder> <prototype.html>
```

## Files

| File | What it is |
| --- | --- |
| [SKILL.md](SKILL.md) | What it does, when to use it, the commands, the lines it keeps, the agent endpoints |
| [HOSTING.md](HOSTING.md) | Putting a canvas on a website: play mode, locks, shared comments through a Cloudflare Worker or GitHub sign-in, and where a host's secrets go |
| `Design Canvas.cmd`, `Design Canvas.command` | Double-click launchers for Windows and Mac: they run `scripts/app.mjs` |
| [scripts/app.mjs](scripts/app.mjs) | The launcher: a folder from the system's picker, then a numbered menu |
| [scripts/runtime/local.js](scripts/runtime/local.js) | Editing from disk with no server: the page writes into the folder it is given |
| [scripts/canvas.mjs](scripts/canvas.mjs) | `build`, `serve`, `check`, `accept`; `buildCanvas`, `serveCanvas` and `acceptFiles` for a caller that works its own layout out |
| [scripts/check.mjs](scripts/check.mjs) | The gate, through a real browser, on a copy held in memory |
| [scripts/lib/html.mjs](scripts/lib/html.mjs) | A prototype as elements with their source offsets, and every edit as a replacement at them |
| [scripts/lib/html.test.mjs](scripts/lib/html.test.mjs) | Every edit op checked to change only its own bytes (`node --test scripts/lib`) |
| [scripts/lib/events.mjs](scripts/lib/events.mjs) | Comment, edit and board lines: written, read, checked and folded |
| [scripts/lib/inline.mjs](scripts/lib/inline.mjs) | A prototype made self-contained |
| [scripts/lib/crop.mjs](scripts/lib/crop.mjs) | One option's column cut out of a comparison board |
| [scripts/lib/browser.mjs](scripts/lib/browser.mjs) | Finds a Chromium the machine already has, to measure and to check |
| [scripts/runtime/shell.html](scripts/runtime/shell.html) | The page: top bar, board, panels, toolbars |
| [scripts/runtime/board.js](scripts/runtime/board.js) | Pages, layout, pan and zoom, frames, comments, the whiteboard's objects and selection box, Play |
| [scripts/runtime/canvas.css](scripts/runtime/canvas.css) | The window's look |
| [scripts/runtime/editor.js](scripts/runtime/editor.js) | Selection, the selection box, the floating toolbar, text in place, structure edits, keys, comment anchors |
| [scripts/runtime/panel.js](scripts/runtime/panel.js) | The right panel: layers, Properties, Code, Tweaks |
| [scripts/runtime/editor.css](scripts/runtime/editor.css) | The editor's and the panel's look |
| [examples/plain/](examples/plain/) | Three small prototypes (levers, script and links, fluid) to build, serve and check against |
| [site/](site/), [index.html](index.html) | The canvas at [ryanallen.com/design-canvas](https://ryanallen.com/design-canvas/), built in play mode: `node scripts/canvas.mjs build site --out index.html` |
