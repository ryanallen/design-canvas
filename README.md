# design-canvas

A skill that puts a folder of HTML prototypes on one board. You can view them, click through them, edit them and comment on them. Every edit is saved back into the prototype's own `.html` file.

Every page is also a whiteboard, with sticky notes, shapes with text, sections, arrows that stay attached, and a box you can draw to ask your agent about what's inside it. A folder with no prototypes opens as a plain whiteboard.

It only needs Node. There's nothing to install, no build step, and the canvas never fetches anything from the internet.

## Install

Clone or copy this folder into a project's `.agents/skills/design-canvas/` folder (or `.claude/skills/design-canvas/`). Your agent reads [SKILL.md](SKILL.md) to learn how to use it.

## Use

Double-click **Design Canvas.cmd** on Windows or **Design Canvas.command** on a Mac. It asks you to pick your folder of prototypes. Then you can build the canvas and open it, open it as it is, check it, or serve it.

A built `canvas.html` opened in Chrome or Edge can edit itself. Click **Viewing · Edit** at the top and pick its folder once. Nothing is left running in the background.

Both ways need [Node](https://nodejs.org) installed.

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
| [HOSTING.md](HOSTING.md) | How to put a canvas on a website. Covers play mode, locks, shared comments through a Cloudflare Worker or GitHub sign-in, and where a host's secrets go |
| `Design Canvas.cmd`, `Design Canvas.command` | Double-click launchers for Windows and Mac. They run `scripts/app.mjs` |
| [scripts/app.mjs](scripts/app.mjs) | The launcher. It asks for a folder, then shows a numbered menu |
| [scripts/runtime/local.js](scripts/runtime/local.js) | Editing from disk with no server. The page writes into the folder you give it |
| [scripts/canvas.mjs](scripts/canvas.mjs) | `build`, `serve`, `check`, `accept`; `buildCanvas`, `serveCanvas` and `acceptFiles` for a caller that works its own layout out |
| [scripts/check.mjs](scripts/check.mjs) | The gate, through a real browser, on a copy held in memory |
| [scripts/lib/html.mjs](scripts/lib/html.mjs) | A prototype as elements with their source offsets, and every edit as a replacement at them |
| [scripts/lib/html.test.mjs](scripts/lib/html.test.mjs) | Every edit op checked to change only its own bytes (`node --test scripts/lib/*.test.mjs`) |
| [scripts/lib/events.mjs](scripts/lib/events.mjs) | Comment, edit and board lines: written, read, checked and folded |
| [scripts/lib/room.mjs](scripts/lib/room.mjs) | Who else has the canvas open and where their pointer is. It imports nothing, and the served canvas speaks it over a WebSocket at `/api/room` |
| [scripts/lib/write.mjs](scripts/lib/write.mjs) | Writes every file whole or not at all, by writing a hidden file beside it and renaming it over the original |
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
| [index.html](index.html), [landing/](landing/) | The page at [ryanallen.com/design-canvas](https://ryanallen.com/design-canvas/), which explains the canvas and how to get it. It's a static page, with its pictures in `landing/` |
| [site/](site/), [play/](play/) | The live canvas at [ryanallen.com/design-canvas/play](https://ryanallen.com/design-canvas/play/), built in play mode with `node scripts/canvas.mjs build site --out play/index.html` |
