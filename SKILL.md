---
name: design-canvas
description: Lay a folder of HTML prototypes out on one canvas to view, play, edit and comment on, as HTML and CSS, with every edit written back into the prototype's own file. Use to review prototypes on a board, edit a prototype's text, styles or structure by pointing at it, leave or read comments pinned to elements, or answer comments an agent was asked to act on.
---

# Design canvas

The design canvas puts every `.html` file in a folder on one board.

When you build it, you get one self-contained `canvas.html`. It opens from disk and fetches nothing.

When you serve it, you can edit. Select an element, then retype it, restyle it, move it, group it or comment on it. The change is written into that prototype's `.html` file, at the bytes it touches and nothing else.

When served, the server answers requests for the folder's own files that the prototypes ask for, such as pictures, fonts and modules. It never serves hidden files. Outside the folder, it serves only the pictures and clips a prototype names there, such as a design's `../imgs/`. That way they show with their paths as written.

It works the way HTML and CSS work. The layers are the DOM. The properties are the element's CSS. Elements flow the way the browser lays them out. Only an element that is already positioned moves by `left` and `top`.

On the board, a plain click on a link, button, checkbox or field inside an artboard works it.

- A link to the web opens in a new tab.
- A link to another artboard goes to that artboard on the board.
- A `#` link moves within the artboard.

To select one of these for editing instead, hold Ctrl or ⌘ (or Shift, or Alt) as you click.

A click selects the one element you clicked, and a style goes on that element alone.

With an element selected, hold Alt over another element to see the distance between them, in the prototype's own pixels. When one holds the other, it shows the distance on each side.

To select every copy of an element, use Alt + click, Ctrl+Alt+A (Figma's Select matching layers), or **Select every copy** under the toolbar's …. A copy is an element with the same tag and classes under the same kind of parent. A style then goes into a rule they all follow. Also under …, **Select all with the same fill**, **text color** or **type** picks everything on the screen that shares it, as in Figma.

Ctrl+Shift+A is Figma's Select inverse. In a prototype it selects what sits alongside the selection, leaving the selection out. On the board it selects every object and screen on the page that isn't selected.

Shift + click adds an element to the selection or takes it out. A style on several elements picked this way goes on each of them alone, in one edit, whether they are alike or not. They stay selected.

A selection that holds text without being text itself, such as a group or a card, has Text color, Bold and Italic on the toolbar. Every line in it takes the change, over any style of its own, in one edit, and the selection stays. Bold and Italic show as on when every line already is.

On a phone or tablet:

- One finger drags the board with any tool that does not draw.
- Two fingers pinch to zoom.
- A tap does what a click does.

On a narrow screen, the layout's links are in the canvas menu under the title, and a comment thread opens over the bottom of the screen.

## Commands

Run these from this folder, or give the path to `scripts/canvas.mjs`.

```sh
node scripts/canvas.mjs build  <folder> [--layout canvas.json] [--out canvas.html] [--title t] [--no-measure]
node scripts/canvas.mjs serve  <folder> [the same] [--port 4410]
node scripts/canvas.mjs check  <folder> [--shots <dir>]
node scripts/canvas.mjs accept <folder> <prototype.html>…
```

A person can skip the terminal. **Design Canvas.cmd** (Windows) or **Design Canvas.command** (Mac) asks for the folder, then offers build and open, open, check and serve.

A built canvas opened from disk in Chrome or Edge can edit itself with no server. Click **Viewing · Edit** and pick its folder.

- **build** writes `<folder>/canvas.html`. Every prototype is inlined, and so is the page's own code. Every comment, edit and board line already in the file is kept.
- **serve** builds, then serves the canvas on `http://127.0.0.1:4410/`, reachable from this machine only. If that port is taken, it uses the next free one. If you name a port with `--port`, it uses that one or refuses. Edits go into the prototypes. Comment, edit and board lines go into `canvas.html`. Each file is written whole or not at all. The server writes a hidden file beside it and renames that over it, so a crash or a full disk leaves a prototype or `canvas.html` as it was.
- **check** is the gate. It works through a real browser. It makes each kind of edit and undoes each one. It leaves a comment and a sticky note and reads them back. It opens Play and looks at the page 390 wide. It fails on an error or on any request off the machine. Nothing it does is written to disk.
- **accept** says a prototype changed on purpose since its last canvas edit, because its build script now carries the edits. Then `build` stops refusing it.

Measuring each prototype's height needs a Chromium. `scripts/lib/browser.mjs` finds a Playwright already on the machine, or uses `CANVAS_PLAYWRIGHT` pointing at a `node_modules` folder that holds one. Without one, frames are drawn 1440 × 1000 and `check` cannot run.

## What it reads

- **Prototypes.** Every `.html` in the folder that is not a `canvas*.html` is a prototype. A prototype whose screens are `<section class="screen-page" id="…">` gets one frame per screen. A folder with no prototypes, or one that does not exist yet, builds as a **whiteboard**, which is one empty page named Board.
- **Layout.** The layout is `canvas.json` beside the prototypes, or the file given with `--layout`. Its shape is `{ "title": "…", "pages": [{ "title": "…", "sections": [{ "title": "…", "sub": "…", "groups": [{ "kind": "flat", "frames": [{ "file": "a.html", "hash": "", "label": "a" }] }] }] }] }`. A file with just `{ "title", "sections" }` is one page.

  Group kinds are `flat`, `option` and `other`. An `option` group takes `letter`, `title`, `info` and `recommended`, and shows its first frame large with the rest under it. A frame may carry `crop: "A"` to show one option's column of a comparison board. With no layout, every prototype goes in one grid.
- **Opening on a page.** `canvas.html#page=<id or title>`, such as `#page=summary`, opens on that page. The match ignores case, and it wins over the page last viewed in that browser.

  The first time a browser sees a page, it shows all of it. The exception is a page with more than one section that would show at under 20%. Then it shows the first section and what sits beside it, at a readable size. F or Shift+1 shows everything. After that first visit, the page opens where it was left.

  Page Down and Page Up go to the next and previous screen on the page, filling the window.

  `&screen=<file>` (or `#screen=<file>` alone) opens on that screen instead, zoomed to it, like a Figma link to a frame. **Copy link to this screen** under the toolbar's … puts such a link on the clipboard.

  `#comment=<thread id>` opens on that comment thread, open and in view, like a Figma link to a comment. **Copy link** at the top of a thread puts such a link on the clipboard.
- **Levers.** `<meta name="canvas-levers" content="--accent, --gap">` names the CSS variables shown under Tweaks. A color gets a picker that keeps its alpha. A number gets a slider sized to its unit, plus a field for an exact value. A bare fraction slides from 0 to 1 in hundredths, and a negative number's slider goes below zero.

  A change is written where the prototype's `:root` declares the variable, so the file keeps one value for it. If the variable is declared in the `:root` of a stylesheet the screens link from the folder, it changes in that sheet, and every screen linking it follows.
- **Fluid.** `<meta name="canvas-fluid">` marks a prototype that reflows to any width.
- **Width.** `<meta name="canvas-width" content="390">` draws a prototype that wide on the board, from 240 to 3840, and measures its height at that width. Without it, the width is 1440.

  The artboard tool (A) offers Desktop 1440, Laptop 1280, Tablet 834 and Phone 390. A click on the board makes a new prototype of the chosen size. A drag makes one of any size. A new prototype that is not 1440 wide carries this tag.

  When served, the width on a screen's label changes the width of a prototype already there. Choose Desktop, Laptop, Tablet, Phone or a custom width. It is written as this tag in one edit, and Ctrl+Z takes it back. The board draws every frame of that file at the new width and measures its height there. It follows the tag whenever the file changes, whether by an undo or by an agent.

  A click on a screen's label selects the screen. Properties then shows its Width, which you can set there too (typed, or Desktop, Laptop, Tablet, Phone), and its height as measured. Ctrl+D then copies its file whole to `<name>-copy.html` (the next free name) and places it to the right of the original, past any screen in the way. Screens taken in a drag box are copied the same way.

  An edit never copies, removes, wraps or moves a page's `<html>`, `<head>` or `<body>`.
- **Where comments go.** Set `"comments": "<address>"` in `canvas.json`, or `--comments <address>` on build. When served by node, comments go to the server. When editing from disk, they go into `canvas.html` itself. Anywhere else, they go to that address, or to the hosting site's own `/api/canvas-comments` when none is set.
- **Play.** `"play": true` in `canvas.json` lets every visitor edit the canvas when it is opened from any website, with nothing to pick. Edits, board objects, artboards and comments are kept in that visitor's browser (localStorage), and nobody else sees them.
- **Links.** `"links": [{ "text": "★ Star", "href": "https://…" }]` in `canvas.json` puts those links at the right of the top bar.
- **Room.** `"room": "wss://…/room/<room id>"` in `canvas.json` has everyone who opens the canvas join that hosted room, to see each other's pointers and faces. `worker/` holds the room as a Cloudflare Worker; HOSTING.md says how to put it up. Without it, a served canvas uses its own room and nothing else connects anywhere. With a `.room-key` file beside the prototypes (or `DC_ROOM_KEY`), `serve` joins that room as its host, and people who open the hosted copy with `#invite=<key>` edit it live. With `"url"` (the hosted copy's address) in `canvas.json`, **Copy invite link** in the canvas menu copies that link. HOSTING.md has the steps.

## The lines in `canvas.html`

Everything people do is saved as a line before `</body>`. Each line is one JSON event, and lines are never rewritten.

- `<!-- comment {…} -->` lines carry these ops.
  - `add`. It carries `file` and `anchor` when it is pinned to an element. It carries `box` and `items` when it is about a region of the board, and `page` when it is on the board itself. When it was dropped on a board object (a note, a shape, a section), it carries `item` with `dx` and `dy`, and its pin follows that object's place. `x` and `y` are where it was left. `agent: true` marks it as work for an agent.
  - `reply`, `resolve`, `delete` and `agent`.
  - `edit`, which holds new words for a comment or reply. It is taken only from whoever wrote it.
  - `react`, which turns one of 👍 ❤️ 🎉 👀 ✅ on or off for whoever sends it. A message shows each reaction with how many there are, and who sent them on hover.
  - `place`, which moves a thread's pin. It holds the same place fields as `add` and is taken only from whoever wrote the thread. Whoever wrote a thread can drag its pin somewhere else, as in Figma. A press without a drag opens it.

  Typing @ and the start of a name in a comment offers everyone who has written there. Pick with ↑ ↓, Enter or Tab. An @Name of someone there shows as a mention.

  A thread offers Edit on what the viewer wrote. It offers Delete on that too, and on everything to the owner, as Figma does. An edited message says it was edited.
- `<!-- edit {…} -->` lines hold who, when, the file, the change in words, and a fingerprint of the file after it. The exact change is the file's own diff.
- `<!-- board {…} -->` lines hold these.
  - Notes, titles, rectangles and ellipses, each with its own text.
  - Sections, lines, arrows, pencil strokes and guides.
  - Groups, which are objects sharing a `group` id.
  - Stacking order (`z`).
  - Pages. A page's `order` is its place in the list, set by Move up and Move down in its menu. Duplicate in that menu makes a page after it with a copy of each of its board objects, keeping groups and the arrows between them.
  - Frames moved by hand.
  - The canvas's own name.

  A line or arrow with `from` and `to` (a board object's id or a frame's key) is drawn between those two wherever they move. An empty `from` or `to` lets go.

## What a click picks

In a prototype, a click picks the element under the pointer, down to the line. Esc climbs to what holds it, and Enter goes in.

The canvas menu on the title has **Click selects the whole block**, which works as in Figma. A click picks the outermost block holding what is under the pointer, passing over wrappers nearly as big as the page. Each click inside the selection goes one level in, from the grid to the card to the line. A drag that starts anywhere inside the selection moves the selection itself. **Click selects the exact item** goes back. The choice is kept in that browser.

Hover outlines what a click would pick.

A selected element that you drag goes where you let it go, before, after or inside what is there. Hold Alt as you let go to put a copy there and leave the element where it was.

An element placed by `position: absolute` or `fixed` moves by its left and top instead. Hold Shift to keep it straight across or down. A handle resizes it as drawn, and Shift keeps the proportions.

A right-click opens the menu for what is under it, never the browser's menu.

- In a prototype, the element is picked as a click would pick it, unless it is already in the selection. So a right-click on one of several selected elements keeps them all. Its menu (the toolbar's **…**) opens there.
- On a board object, the object is picked with its group. The menu has Copy, Paste, Duplicate, Bring forward and Send backward (Ctrl+] and Ctrl+[, past the next object it overlaps), Bring to front and Send to back (with Shift), Group, Ungroup, Flip across, Flip up and down, Wrap in a section, Zoom to selection, Select matching, Lock and Delete.
- On empty board, the menu has Paste, Select all, Zoom to fit and the keyboard shortcuts.

Text being typed keeps the browser's own right-click menu, so its spelling suggestions still work.

In a prototype, the arrow keys nudge a positioned element (absolute, fixed, relative or sticky) by 1 px, or 10 with Shift. Each selected element moves from its own place, and each press is one undo step. Alt+arrows move an element in the flow one place along in it.

## Typing in place

With text selected (not being typed in), Figma's text keys step it up with > and down with <. Ctrl+Shift changes the size by 1px, Ctrl+Alt the weight by 100, Alt+Shift the line height by 1px, and Alt the letter spacing by 0.5px. Each selected element steps from its own value, in one undo step. Ctrl+Alt+L, T, R and J align it left, center, right or to both edges, as the toolbar's Align does.

Ctrl+Shift+8 turns a line of text into bullets and Ctrl+Shift+7 into numbers. The same key on that kind of list turns it back into a paragraph. Ctrl+Shift+X adds or removes a strikethrough, on a selection or on words picked while typing. An underline that's already there stays.

Enter or double-click on a selected text element starts typing in it. While typing:

- Enter goes on in a new element after it, as a text editor does. The new element has the same tag and attributes, except the id (a paragraph after a heading). It never puts a `<div>` inside the paragraph.
- Backspace at the start of an element that Enter made joins it back on. Delete at the end of the element before it does too.
- Tab ends typing, saves, and selects the next part. Shift+Tab selects the one before.
- Shift+Enter is a line break inside the element.
- Escape ends typing. So does Enter in a one-line element.

Everything typed is one edit for Ctrl+Z, however many elements Enter made.

Sometimes the file changes outside the canvas while someone types in it, for example when an agent writes it. The typing goes on, and the screen redraws when it ends. The words go into the element typed in, wherever the change moved it in the file. If the change rewrote that element itself, nothing is written over it. Instead, the words are copied, with a hint, so you can paste them where they belong.

Every file a page draws carries the version it was drawn from, as `data-dc-v` on its `<html>`. This never appears in a download. The server refuses an edit made from an older version. So a change made just before an agent's write reaches the screen is not written into whatever now stands where its element stood. The screen redraws, and the change is made again.

After an outside write, Ctrl+Z and Ctrl+Shift+Z undo or redo the edit where it now stands and keep the outside change (`scripts/lib/rebase.mjs`). If the outside change touched that very place, nothing is undone. The hint says so, and the step stays for another try.

## History

**History**, in the canvas's own menu on its title, lists every edit the canvas has recorded, newest first. Each entry shows who made it, when, in which prototype and what it did. These are the same lines `canvas.html` keeps, read live through `/api/history` when served or when editing from disk. **Show** goes to that prototype.

## Flows

**Show flows on the board**, at the top of the Play menu, draws an arrow from each link in a screen to the screen on the page it opens. That covers a link to `other.html` or `other.html#screen`. It works like Figma's prototype connections. The arrow goes up from the link, over the tops of the screens, and onto the top edge of the screen it opens. The setting is kept in that browser until **Hide flows**.

## Commenting in Play

Play shows a screen at full size. ← and → step through the page's screens. R starts over from the screen it was opened on, as that screen first was.

A click on something that does nothing briefly lights up everything on the screen that does something, such as links, buttons and fields. This is how a Figma prototype shows its hotspots.

Where comments can be left, press C or the comment button in Play's header, then click the prototype. That pins a comment to the element there. It gets the same anchor as a comment made on the board, so it shows in both places. The pins for the screen being played sit over it and follow it as it scrolls. A pin opens its thread above Play.

## Layers

The panel's Layers list the page's board objects and frames, and an open frame's elements. Each is named by its `data-name` or `aria-label`. Without those, it is named by what it is and what it says.

**Find a layer**, at the head of Layers, lists every board object, screen and element of a loaded screen whose name holds what is typed. The list is flat, and each entry shows its screen. A click selects it. Escape empties the search.

When served, a layer dragged onto another goes before or after it, depending on which half it is dropped on. Dropped on the middle of a layer that holds others, it goes inside. Each drop is one move in the file.

To select rows:

- A click on a row selects it.
- Shift+click selects every row shown from the one clicked last to this one. A row inside another row taken this way is left to its parent.
- Ctrl+click adds a row or takes it out.
- Alt+click selects every copy.

Double-click a layer to name it in its row. Ctrl+R names the selected layer, opening the panel if it is shut. The name is written as `data-name` when Enter is pressed or the row is left. Escape keeps the old name. An empty name takes it off.

The eye on a layer, or Ctrl+Shift+H, hides it and shows it again, in one undo step. If the layer is in the selection, the whole selection is hidden. Hiding writes `display: none` on the element, so Play hides it too. If the element has a display of its own, such as `flex` written by Layout, that is kept in `data-display` while it is hidden and comes back with it.

A hidden layer's row is dimmed. When it is selected, Properties shows its values as they are when shown, says it is hidden, and has Show.

## Copy and paste

Ctrl+C in a prototype copies every selected element, in page order, as its file has it. Ctrl+V puts them after the selected element, or inside it when that is the page's body.

Pasted into the same prototype, they stay plain markup styled by its classes.

Pasted into another prototype, each part carries on itself whatever of its look that page would not give it. That covers colors, type, spacing, corners, shadows and layout. It never covers width or height, so the part fits where it lands. The canvas finds what to carry by trying the part in place. If the page links the same stylesheet, the classes already give the part its look. Then nothing is written on it, and a change to the sheet still reaches it.

An `id` already on the page gets a new one.

Ctrl+Shift+C copies a picture of the selection as a PNG, like Figma's Copy as PNG. **Export PNG** under … saves it. It takes the element alone, or the whole screen when its label was clicked. The picture is the size its frame is drawn, doubled for sharpness.

A whole screen selected by its label moves on the board with the arrow keys (10 at a time with Shift), as a Figma frame does. Ctrl+Shift+G and Alt+arrows leave it whole.

A screen selected this way has **Mode** in Properties' Screen section, like a Figma frame's variable mode. The choices are Auto, Light and Dark. Light or Dark turns the screen's own `prefers-color-scheme` rules on or off for that screen alone, whatever this computer is set to. Only what is seen changes, never the file. The mode is kept per screen in this browser, and a PNG or PDF of the screen comes out in that mode.

**Export the screen as PDF** under … saves the screen the selection is on as one page. The page is the screen's own width, and as tall as its frame is drawn, or as the page if that is longer. It looks as it does on screen, and its words stay as type. It is made by the same browser the server uses, so it needs a served canvas.

Ctrl+Alt+C copies the selected element's properties. Ctrl+Alt+V pastes them on every selected element, in this prototype or another. Both are in the toolbar's **…** menu too. Only the look is copied. That means fill, gradient, borders, corners, shadow, opacity, text color and type. Size, place and content are never copied, and only what differs is written.

Pasted on a box that holds text, such as a card, the box takes the fill, borders and the rest. Every line of text in it takes the type and text color, over any of its own. A picture fill is left out, since its address as read is the served one. Pasted on every copy of something, the properties go into their shared rule.

## Group

Ctrl+G in a prototype wraps the selected elements, side by side in one parent, in a new `div`. Ctrl+Shift+G takes a wrapper away and keeps what it held.

As in Figma, grouping moves nothing. In a grid or a flex row, the group is written with `display: contents`, so each part keeps its own cell. The group is selected and measured by the box around its parts.

**Wrap in flex row**, **flex column** and **grid** under … make a wrapper that lays them out instead.

**Shift+A** (Add auto layout, also under …) works as in Figma. One element holding others becomes a flex box itself. Anything else selected is wrapped in a new flex box. It is a row when the parts sit side by side, and a column otherwise. Its gap is the space already between them, less their margins, so nothing moves. In a column, the blocks stretch across as before, and an inline element such as a button keeps its own width.

## Code tab

**Copy CSS** at the top of the tab copies the styles that apply to the element as one CSS block under its class, as Figma's Dev Mode does. Each property is there once, with the value that wins.

The **Code** tab first shows the element's own style, which you can edit. Then it lists each rule that matches the element, strongest first, ranked as the cascade ranks them, by `!important`, then specificity, then order in the file. Every declaration that a stronger one overrides is struck through, so the value shown unstruck is the one that applies.

A rule in the prototype's own `<style>` is editable there. Its values show as the file writes them, and its heading counts the elements it styles. You can change a value, add one in the empty row under the rule, or empty one. The change is written into that rule where it stands, as a `decl` edit and one undo step. Every element the rule matches follows, and nothing else does.

A rule in a stylesheet the prototype links from its folder, such as a shared `portal.css`, is editable the same way. Its heading names the sheet and how many screens link it. The change is written into that `.css` file in one undo step, and every screen linking it redraws. The same happens when the sheet is changed outside the canvas.

A rule that styles a locked part stays as it is. The canvas's own overrides, a sheet outside the folder and rules from elsewhere are read only. They have + to set a value on the element itself.

After the rules, the tab shows the element's attributes, what it inherits and from which ancestor, and its source.

## States

Properties has **Default · Hover · Pressed · Focus** above an element's properties. In a state:

- The board shows the element as it looks in that state, with every `:hover`, `:active` or `:focus` rule for it applied, both the prototype's own and the canvas's.
- Properties reads those values.
- A change is written as that state's rule for the element's id, or else for its tag and classes, so Play shows it for real. If the element has neither, the canvas asks for one.

**Motion** (None, Quick, Smooth, Slow) sets how fast the element changes into a state and back. It is a CSS `transition` on the element itself.

**Entrance** is how the element comes in when the page opens. The choices are these.

- Fade, Rise, Pop and Slide.
- Bounce, with a middle keyframe past its place.
- Custom, with its own first keyframe. It goes from a start opacity, scale, turn and X · Y to its resting look. With Middle on, it has a middle keyframe with its own X · Y and scale, at 60% of the way unless moved (5 to 95). With Another on, it has a second one, at 85% unless moved.

An entrance has a speed (Quick 250, Smooth 450, Slow 800 ms) and a delay in ms, to stagger it after what is above it. ▷ plays it again on the board, and Scrub holds it at any moment. Leaving Custom takes its own `@keyframes` out of the file.

**Stagger** shows when there are two or more siblings of the element's tag and class, such as a row of cards. It gives them all the same entrance, each 60, 120 or 200 ms after the one before, in one edit. That is the `styles` edit, which sets several elements' own styles at once. Off leaves the entrance on this element alone.

▷ plays every entrance on the screen again.

An entrance is an `animation` on the element and the `@keyframes` it names. The same edit writes those into one `<style data-canvas-keyframes>` in the head, so Play and the file run it wherever it is shown. Properties reads an element's resting look, never a frame of its entrance.

## Fonts

Number fields in Properties work as in Figma.

- A sum typed in a field is worked out, such as 24*2, 100/4 or (16 + 8) / 2, with the unit kept.
- ↑ and ↓ step the value (10 with Shift). Each step is written with its unit kept, and the field keeps keyboard focus.
- Dragging across a number row's label scrubs the value (10 at a time with Shift). It is written once when you let go.

Properties' **Appearance** holds the element's look. Each change is one undo step.

- **Fill** is a color. With ◐ it is a gradient (Linear, Radial or Angular, with two colors and an angle). With ◍ it is a point mesh. That means color points you drag on the element, each a radial gradient fading at its spread, in plain CSS. With ◫ it is a grid mesh, a lattice of 2 to 6 rows and columns whose points you drag to bend the colors. The grid mesh is drawn to a small picture in the element's own CSS, and the lattice is kept in `data-mesh` so you can edit it again.
- Every color field has ▦. It lists the screen's levers (custom properties on `:root` holding a color) and the colors the screen already uses. A lever picked in Fill or text Color is written as `var(--name)`.
- **Opacity**, **Blend** (the sixteen blend modes) and **Clip content** (overflow cut at the edge and radius).
- **Radius** is one value, or one per corner.
- **Border** reads the side that has one, so a line under a bar shows. Its style changes only the sides that have it. **Border sides** sets each side's width, and a new side takes the line's style and color.
- **Shadow** lists each shadow of the element in turn, with Drop or Inner, X, Y, Blur, Spread and color. + adds another.
- **Layer blur** and **Background blur** change only the `blur()` of `filter` and `backdrop-filter`.
- **Selection colors**, under Appearance, lists every color in the selection and inside it. Each is named by its uses (Text where words hold it, Fill, Border), most used first. A color changed there changes on every element of the selection that has it, in one edit.

Size has these controls.

- ⛓ beside Width keeps the element's proportions, like Figma's constrain proportions. Its shape as drawn is written as its `aspect-ratio`, and its height follows its width, never shorter than its words. Press it again and the ratio goes, and the element keeps the height it has.
- **Min · Max** width or height shows under the size where one is set, or after you press ⇔ beside it. It is read and written as drawn, with padding and border included, as Width is. When emptied, a limit written on the element goes, and a limit from its CSS is overruled.
- **Rotation** in degrees, ↻ for a quarter turn, and ⇋ ⇵ (Shift+H, Shift+V) to mirror. These use the CSS `rotate` and `scale` properties, apart from any `transform`. A turned element's width and height read as laid out.

A picture or video has **Fit** (Fill, Fit, Stretch, Original) and **Focus**, which sets where a crop keeps its middle. A picture also has **Alt text**.

Text has these.

- **Case** shows it in upper, lower or title case. The words in the file stay unchanged.
- **Truncate** (Lines) stops the text with an ellipsis past so many lines.
- **Text shadow** is a shadow that follows the letters (`text-shadow`, with X, Y, Blur and its color).

Properties › Font lists the fonts the prototype already uses, the fonts on this computer, and generic families. On a served canvas it also lists **web fonts** from Google Fonts.

Picking a web font saves the family's latin woff2 files once into the folder's `fonts/<family>/`, with `fonts/<family>.css` holding their `@font-face` rules. It links that sheet from the prototype's head as a `link` edit, which undoes like any other. Then it sets the font. The prototype holds its own copy, so the font shows for everyone who opens it, and offline. A built canvas writes it in with the rest.

A font picked from this computer shows only where that font is installed.

## Find and replace

Ctrl+F opens Find. It counts the words wherever they appear in the text of the page's artboards and board objects, in any case. Enter and Shift+Enter step through them, selecting and zooming to each one.

**Replace all** puts the new words in every place. Each takes the case of the words it replaces, so "Swell" becomes "Surf" and "SWELL" becomes "SURF". The exception is new words that have capitals of their own.

It works through `replaceText` in `scripts/lib/html.mjs`, which changes only text between tags. It never changes a tag, an attribute, a comment, a script, a style or a locked part. On a locked screen it changes nothing. One Ctrl+Z takes all of it back, on every screen and board object at once.

## Components

**Make component…** under the toolbar's … (Ctrl+Alt+K) names the selected element a component. It carries `data-component="Name"`. Every element with that name in the file is a copy of it. On a canvas served by node, so is every one on the other screens, and they take the same change in the same undo step. A screen locked on the board is left as it is. Duplicate a copy to make another.

A style, an attribute, or a part added, duplicated or removed anywhere inside one copy is made at the same place in every copy, and the toolbar says so. Some things stay a copy's own. These are text typed into it, markup replaced whole in the Code tab, its `id`, and anything in a locked part.

The toolbar shows **◇ Name · n** inside a copy. A click on that selects the copy whole. **Select all n Name** selects every copy. **Detach from component** makes one copy a plain element again.

**Make a variant…** gives a copy a variant name (`data-variant`, like Figma's variants). A style or attribute changed on it then reaches only copies of that variant. Parts added or removed still reach every copy. The toolbar shows **◇ Name / Variant · n**.

**Switch to …** in the toolbar's … menu works on a copy selected whole and gives it another variant. Each of its parts takes the style the same part has in a copy of that variant. The copy takes that variant's name and keeps its words, all in one edit.

`applyEdit` in `scripts/lib/html.mjs` makes the change in every copy, so an agent's edits through `/api/edit` reach them all too.

## The whiteboard

Every page is a whiteboard, with or without prototypes on it.

**Templates…** in the canvas's menu, and "start from a template" on an empty board, puts down a Retro, a Kanban, a Journey map or a Flowchart. It goes in the middle of the view. Where that would cover screens or objects, it goes beside everything on the page instead. It arrives selected, in one undo step.

The tools are these.

- Sticky note (N). **Name** on a picked note's bar shows who made it at the foot of the note, as FigJam's Show author does.
- Text (T).
- Pencil (P). The bar over the toolbar offers Fine, Marker, Bold or a see-through Highlighter, and a color. A picked stroke, line or arrow is made S, M or L on its bar.
- Stamp (E), with 👍 ❤️ ⭐ ✅ ❓ 🔥 +1 chosen on the bar over the toolbar. A click puts one down. It is held by the note, shape or picture under it, so it moves with that, and it is named for who put it there. **Stamps, counted** in the canvas's menu lists what has stamps on it, most first, with how many of each kind.
- Under the shape button, rectangle (R), ellipse (O), diamond, triangle, section (S), line (L), arrow (Shift+L) and layout guide. As in Figma, drawing with Shift makes a square, circle or level line, and drawing with Alt draws from the middle.

Double-click a note, a shape or a section to type in it. Double-click a line or arrow to give it a label, drawn on its middle.

A picked note or shape shows a dot beyond each side. Drag a dot onto another object to draw an arrow held by both. Let it go on empty board to make another object like the first there, held at that end and ready to type in. Click a dot without dragging to put another one like it on that side, joined by an arrow. If that spot is taken, it goes on along the side until it finds room. Each way is one undo step.

A picked shape's bar turns it into another shape in place, keeping its words and the lines bound to it. The bar also leaves it an outline (▢) or fills it with a tint of its color (■).

A picked line or arrow's bar sets these.

- Straight, Elbow or Curve.
- No heads (—), a head at its end (→) or heads at both ends (↔).
- Solid or Dashed.

A line bound to an ellipse, diamond or triangle meets its outline.

A note, rectangle or ellipse given more words than it holds grows down to hold them all.

A picture (PNG, JPEG, GIF, WebP or AVIF) dropped on the board or pasted with Ctrl+V is saved into the folder's `images/`. The same picture again uses the file already there. It is placed there at its own size, no wider than 1200. Its corner resizes it in proportion, and Shift lets the proportions go. `canvas.html` carries the board's pictures inside it, up to 10 MB in all, so a canvas sent alone still shows them.

Words pasted with Ctrl+V make a sticky note where the pointer is, grown to hold them. With a prototype element selected, they make a paragraph a line after it instead, or inside it when it holds others.

A picture dropped on a prototype, or pasted while one of its elements is selected, goes into that prototype's file. On an `<img>`, it takes that image's place, and the old picture's `srcset` goes with it. Anywhere else, a new `<img>` goes after the element, or inside it when it holds others. It is one undo step. This works when served or when editing from disk. A canvas held in memory, or the published one a visitor plays with, says the picture needs the folder.

A title's bar sets its size to S, M, L or XL.

A section is a labeled area drawn under everything else. Dragged by its label or its border, it carries every object and frame wholly inside it. A drag anywhere else inside it draws a selection box.

Undo, nudging, order and zoom work like this.

- Ctrl+Z undoes and Ctrl+Shift+Z (or Ctrl+Y) redoes whatever was done last, on the board or in a prototype, in one history. A board step is everything one action changed, such as a group dragged, an align or a paste, put back as it was. Undoing or redoing a board step brings back the selection you had when you made it, as Figma does. If none of it is left, the objects it changed are selected. In a prototype, undo and redo select the element the change was in.
- The arrow keys nudge what is selected on the board 1 px, or 10 with Shift. A section moves with what is inside it. A locked object, or a line bound to objects, stays put. Each press is one undo step.
- Ctrl+] brings the selected objects forward one place and Ctrl+[ sends them back one place. Ctrl+Shift+] and Ctrl+Shift+[ take them all the way to the front or back. The order is kept as a `z` on their board lines.
- Shift+2 zooms to what is selected, on the board or in a prototype. Shift+1 zooms to everything.
- Ctrl+= and Ctrl+− (or + and −) zoom the board in and out. Ctrl+0 (or 0) sets it to 100%. These never change the browser's zoom of the whole page.

A dragged board object catches its edges and center on those of other objects and frames it passes, and draws the line it caught on. Like Figma's smart spacing, a drag also catches the middle between two neighbors in its row or column, or a gap that row already keeps. The equal gaps are marked in pink with their width. Hold Ctrl or ⌘ to let it go anywhere.

Hold Alt over another object to see in red how far it is from what is selected, as Figma measures.

Hold Shift to keep a drag (a screen's too) straight across or straight down, whichever way it has gone further. Shift also keeps a note or shape in proportion as its corner resizes it. Hold Alt while resizing to keep its middle where it is. A corner pulled with neither key catches the edges and centers near it, as a move does.

A line or arrow begun or ended on a note, shape, section or frame holds on to it and follows it. Dragging the line itself lets go.

While editing, you select like this.

- A drag from empty board with the select tool draws a selection box. With Shift held, it adds what it takes in to the selection.
- Shift + click adds an object to the selection or takes it out.
- Ctrl+A chooses every object and frame on the page. In a prototype, it chooses everything alongside the selected element.
- **Select matching** (Ctrl+Alt+A, also in the right-click menu with a count) chooses every object on the page of the same kind and color as those selected.
- Tab picks the next object on the page in reading order (Shift+Tab the one before) and brings it into view. Enter types in the one picked.

With a selection, you can do these.

- Move it. Everything selected moves together.
- Color it. It takes one color from its bar.
- Delete removes its board objects.
- **Wrap in a section** (Ctrl+Alt+G, also in the right-click menu) draws a section around them, with 60 clear on every side and its name ready to type.
- **Group** (Ctrl+G) makes them one group. A click on any member picks the group whole. Ctrl+click picks the one member, like Figma's deep select. When several were chosen together by a box or Ctrl+A, a click that does not move takes that one alone. The group moves, colors and deletes as one until **Ungroup** (Ctrl+Shift+G). Screens can be in a group too. A screen in a group moves with it, from its label too, and deleting a group leaves its screens.
- **Align** lines them up by an edge or center, or spaces three or more evenly. It uses Figma's keys, Alt+A, H, D, W, V, S, and Alt+Shift+H or V.
- **Flip** (Shift+H across, Shift+V up and down, also in the right-click menu) mirrors them within the box around them. A free line, arrow or drawing is turned over with them.
- **Tidy up** (Ctrl+Alt+T, also under Align) puts them in a grid in reading order, each in a cell as big as the biggest and 40 apart. Where they already lie in a row or a column, it makes a row or a column.
- Ctrl+D duplicates. The copies are moved and stay selected. Ctrl+D again puts the next copies as far on again, as Figma steps them.
- Alt + drag places a copy where the drag ends.
- Ctrl+C and Ctrl+V copy and paste. Ctrl+Shift+V (Paste in place) puts the copies exactly where the originals were, on whatever page is open. A line copied together with both objects it holds holds the copies.
- Ctrl+Shift+R (Paste to replace) puts what was copied in place of what is selected, centered on it, in one undo step. In a prototype it replaces the one selected part. With nothing copied, the key is left to the browser.
- **Page** on the bar moves the selection to another page, at the same spot. An arrow between two things that both move goes with them. An arrow holding only one of them lets go of it where it is drawn.
- **✦ Ask agent** leaves the agent a thread carrying the box and everything in it.

When served, every open copy of the canvas redraws when anyone changes the board.

Everyone with a served canvas open sees each other, as in Figma. Each person's pointer shows on the board with their name in their color, so does a box round whatever they have selected (a board object, a screen, or a part of a screen), and their face (initials) shows at the right of the top bar. Clicking a face follows that person, as in Figma: your view shows what theirs does, page and zoom too, with a ring in their color, until you pan, zoom or press a key yourself (or click the face again, or Stop). **Spotlight me** in the canvas menu has everyone else follow you, as in Figma, and anyone who comes in while it's on; each can still Stop. **Stop the spotlight** lets them go. Press / for cursor chat, as in Figma: a few words typed by your pointer show to everyone else as you type them. Enter leaves them up for four seconds, Escape takes them away. The server holds this as a room at `/api/room`, a WebSocket that only the canvas's own page may open. `scripts/lib/room.mjs` holds the room and imports nothing.

`build` refuses a prototype whose file no longer matches its last edit line. That way a rebuild by the prototype's own script never drops a canvas edit silently. Carry the edits into the script, then run `accept`.

Shift+C hides the comment pins on the board, or shows them again. This is kept in that browser. The comment tool and the Comments tab still show them.

A thread with a message someone else wrote since you last opened it shows a red dot on its pin and in the Comments list, as Figma marks unread comments. Opening it marks it read, and **Mark all read** at the top of the Comments tab clears every dot at once. What you have read is kept in that browser.

The **Comments** tab lists the threads, numbered. Above the list are these.

- A search finds words in a thread or its replies, or a name.
- **Resolved** shows the resolved threads too.
- **Mine** keeps only the threads the viewer started, answered or is @named in.
- The order is as numbered, or **Newest first** by the latest message.

Mine and the order are kept in this browser.

## Working with an agent

From disk, an agent reads the threads straight from `canvas.html`. `parseEvents` and `foldEvents` in `scripts/lib/events.mjs` fold its comment lines. A thread with `agent: true` is work for the agent.

While `serve` runs, the same is answered over HTTP.

- `GET /api/selection` returns what is selected on the board. That is `file`, `cvs` (source offsets) and each element's source HTML. After a selection box, it returns `board` instead, with its `page`, `box`, the board objects inside it in full, and the keys of the frames inside it.
- `GET /api/agent` returns every open thread marked for the agent, with its file, its anchor (or its `box` and `items`) and its replies.
- `GET /api/board` returns every board line, plus `board`, which is the lines folded into `items`, `moved`, `pages` and `name`.
- To change the board, `POST /api/board` with one of these events.
  - `{ "event": { "op": "item", "kind": "note", "x": 0, "y": 0, "w": 360, "h": 260, "text": "…", "page": "p1", "name": "agent" } }`. Adding an `id` updates that object.
  - `{ "op": "remove", "id": "…" }`
  - `{ "op": "move", "key": "<frame>", "x": …, "y": … }`
- To answer a thread, edit the prototype's file. The canvas reloads its frames on its own. Then reply on the thread with `POST /api/canvas-comments` and `{ "event": { "op": "reply", "to": "<thread id>", "name": "agent", "text": "…" } }`. Resolve it with `{ "op": "resolve", "to": "<id>", "name": "agent" }`.


## Sharing

`canvas.html` is the thing you share. Send it, or put it on any static host.

A host that should take comments answers two calls. They go to `/api/canvas-comments` on its own site, or to the address set with `comments`.

- `GET ?path=<page>` returns `{ events }`.
- `POST { path, event }` writes the posted line into the file and returns `{ event }`.

A host on another site is called with its cookies (`credentials: include`), so that host has to allow the canvas's origin. [HOSTING.md](HOSTING.md) walks through each way.

## Locks

The owner is whoever edits where the canvas lives, either served by node or in its folder on disk. The owner locks what others must leave as it is.

- An artboard, by the padlock in its header.
- A board object, by Lock in its bar or a drag box's bar.
- A part of an artboard, by the padlock in its floating toolbar.

A locked artboard or object is not moved, changed or removed until it is unlocked. A play-mode visitor puts nothing new over it.

A locked part is an element with `data-locked`, and everything in it. It is not changed, moved, removed or wrapped, and nothing holding it is retyped or removed.

Board locks are `<!-- board {"op":"lock","key":…,"locked":true} -->` lines. Part locks are in the prototype's own HTML. `lockedFor(src, edit, { owner })` in `scripts/lib/html.mjs` says why an edit is refused.
