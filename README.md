# @mbolli/datastar-attribute-newest-frame

[![npm version](https://img.shields.io/npm/v/@mbolli/datastar-attribute-newest-frame.svg)](https://www.npmjs.com/package/@mbolli/datastar-attribute-newest-frame)
[![Release](https://github.com/mbolli/datastar-attribute-newest-frame/actions/workflows/release.yml/badge.svg)](https://github.com/mbolli/datastar-attribute-newest-frame/actions/workflows/release.yml)
[![GitHub Pages](https://github.com/mbolli/datastar-attribute-newest-frame/actions/workflows/gh-pages.yml/badge.svg)](https://github.com/mbolli/datastar-attribute-newest-frame/actions/workflows/gh-pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A [Datastar](https://data-star.dev) plugin that keeps a page too slow for its SSE stream close to the present: when frames pile up, it applies the newest frame of each view and skips the ones it replaces.

## About

[Datastar](https://data-star.dev) applies every event of an SSE stream as it arrives. A server that streams a view ten times a second never waits for the page: the browser and the kernel take minutes of frames before a write blocks. A page whose main thread needs more than 100 ms per frame falls behind, and the server cannot tell.

- **Chromium** then hands the page up to 2 MiB of the stream at each read, and Datastar applies every frame in it inside one task, with no paint in between. In [lith](https://github.com/zweiundeins/lith)'s Game of Life at 30× CPU throttling, a page fell 94 s behind in two minutes and painted once every 14 s.
- **Firefox** keeps the frames in its parent process and hands the page one per task. It keeps painting, but at 300 ms per frame it fell 77 s behind in 110 seconds.

With `data-newest-frame`, the same pages stayed about a second behind. A page that keeps up applies every frame at once, as before.

## Installation

```bash
npm install @mbolli/datastar-attribute-newest-frame
```

## Demo

**[View Interactive Demo →](https://mbolli.github.io/datastar-attribute-newest-frame/)**

The demo streams a Game of Life from a Service Worker through Datastar's own fetch, with a slider for the cost of applying a frame, and charts how far behind the page falls with and without the plugin. It also shows the measurements from lith.

## Usage

This plugin requires an import map to resolve the `datastar` module. Set up your HTML like this:

```html
<script type="importmap">
{
  "imports": {
    "datastar": "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.4/bundles/datastar.js"
  }
}
</script>
<script type="module">
  // Import the plugin: it registers itself with datastar
  import 'https://cdn.jsdelivr.net/npm/@mbolli/datastar-attribute-newest-frame@1/dist/index.js';
</script>
```

Note: Using `@1` will automatically use the latest v1.x.x version. The import map has to come before every module script on the page, or Firefox ignores it.

## What it does

This plugin adds a `newest-frame` attribute to Datastar that holds the patch events of one SSE stream and applies only the newest frame of each view among those that arrived together.

### Turning it on

```html
<body data-newest-frame>
  <div id="stream" data-init="@get('/stream')"></div>
  <div id="board">...</div>
</body>
```

The stream is the element whose `@get` opened it: `#stream` by default. Name another id after the colon:

```html
<body data-newest-frame:feed>
  <div id="feed" data-init="@get('/feed')"></div>
</body>
```

HTML lowercases attribute names, so the id has to be lowercase. The plugin listens on `window`, so it can sit on any element that lives as long as the stream; `<body>` is the usual place. Events of other elements pass at once, and so do the stream's other events (`started`, `finished`, `error`).

### Which patches it drops

A `datastar-patch-elements` event is a frame of a view when it replaces that view wholly:

- mode `outer` (the default) or `replace`, when every top-level element has an id; the sorted ids name the view;
- the same with a `selector` of that one id;
- mode `inner` with a `#id` selector.

Of the frames of one view that arrive together, only the newest is applied. Everything else keeps its place in the order and is never dropped: signal patches, `append`, `prepend`, `before`, `after` and `remove`, elements without an id, other selectors, and patches with a `<script>` or a view transition.

### When it applies a batch

Datastar dispatches every event of a chunk at once and reads the next chunk after a microtask, so the plugin holds the events of a chunk and passes them on together at the end of it. It waits for the next animation frame when it passed a batch on less than a frame before, and after each batch it waits half as long as that batch took to apply. A page that keeps up gets each frame at once. A page that is behind paints between batches, and in Firefox the frames gather during the wait.

A hidden page and a page whose animation frame does not come within a second (a throttled iframe) get their batches without waiting. Events from a stream element that is no longer in the document are dropped: a stream that was opened again still delivers what the browser holds of the old one.

### The `newest-frame-behind` event

When more than half of the frames of the last 3 seconds were skipped, at least 10 frames, the plugin dispatches `newest-frame-behind` on the stream's element. It bubbles, and the counts start over, so a page that stays behind gets one about every 3 seconds.

| `evt.detail` | |
|---|---|
| `id` | the stream's id |
| `frames` | frames (element patches) that arrived in the span |
| `skipped` | how many of them were skipped |
| `span` | the milliseconds the counts cover, 2,700 to 3,000 |
| `reopen` | whether `__reopen` is set |

```html
<body data-newest-frame data-on:newest-frame-behind="$behind = evt.detail.skipped + ' of ' + evt.detail.frames + ' frames skipped'">
```

### Asking for a slower stream: `__reopen`

With `__reopen`, the first time the page falls behind, the plugin also sets `$_slow` to `true` and replaces the stream's element with a copy of itself. Its `data-init` runs again and opens the stream at the same URL, so Datastar aborts the old request. Send a header while `$_slow` is set, and the server can answer with fewer frames:

```html
<body data-signals:_slow="false" data-newest-frame__reopen>
  <div id="stream" data-init="@get('/stream', {headers: $_slow ? {'Save-Data': 'on'} : {}})"></div>
</body>
```

It asks once, and never when `$_slow` is already true, for example because the page measured a slow link as it started. The `newest-frame-behind` event fires just before it reopens the stream.

[lith](https://github.com/zweiundeins/lith)'s template and site load the plugin this way: a lith stream whose request sends `Save-Data: on` sends each view at most four times a second.

### Registering it yourself

The module registers the attribute itself once `import('datastar')` resolves. Where it cannot, register the default export:

```js
import { attribute, getPath, mergePaths } from 'datastar'
import newestFramePlugin from '@mbolli/datastar-attribute-newest-frame'

attribute(newestFramePlugin(getPath, mergePaths))
```

### What it relies on

The plugin reads the `datastar-fetch` events that Datastar 1.0.x dispatches on `document` for every SSE event, with their `type`, `el` and `argsRaw`. Datastar does not document those patch types, though its own virtual-scroll example dispatches them the same way. It was built and measured against Datastar 1.0.4.

## Measurements

From [lith](https://github.com/zweiundeins/lith)'s Game of Life demo, stepping ten times a second, in headless Chromium and Firefox on Linux. Behind is how long ago the board passed the generation the page shows.

| Chromium, DevTools CPU throttling, 2 minutes | Without | With the plugin |
|---|---|---|
| 1× | 0 s | 0 s |
| 15× | 43 to 45 s | 0.64 s (at most 1.04 s) |
| 30× | 94 s | 1.11 s (at most 2.00 s) |

| Firefox, a fixed cost per frame, 110 s | Without | With the newest-frame rule |
|---|---|---|
| 0 ms | 0 s | 0 s |
| 80 ms | 2.8 s | 0.14 s (at most 0.56 s) |
| 150 ms | 46 s | 0.65 s (at most 0.65 s) |
| 300 ms | 77 s | 0.86 s (at most 1.16 s) |

The Firefox runs applied the same rule from a page script that held frames until the next animation frame. lith's v0.3.0 release measured the plugin itself: at 300 ms a frame, Chromium 154 and Firefox 158 both stayed within 0.8 s. The [demo page](https://mbolli.github.io/datastar-attribute-newest-frame/#measured) has the details of each run.

## Testing

Run the automated tests:

```bash
pnpm test
```

Or run `pnpm test:browser` and open http://localhost:8080 to run the demo against the local build. The demo's Service Worker needs `localhost` or HTTPS.

## Development & Releases

This project uses automated releases via GitHub Actions. When you push to `main`:

1. **Tests run automatically**: build and tests must pass
2. **Version bumping**: add to your commit message:
   - `[major]` for breaking changes (1.0.0 → 2.0.0)
   - `[minor]` for new features (1.0.0 → 1.1.0)
   - Default: patch for bug fixes (1.0.0 → 1.0.1)
3. **Automatic publishing**: the package is published to npm
4. **GitHub Release created**: with auto-generated release notes

A commit with `[skip release]` in its message releases nothing.

## License

MIT

## Maintainer

Maintained by [Michael Bolli](https://github.com/mbolli) at [zwei und eins gmbh](https://zweiundeins.gmbh), Aarberg, Switzerland. The plugin started as `live/newest-frame.js` in [lith](https://github.com/zweiundeins/lith), which vendors it from here.
