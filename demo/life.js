// The demo's stream: a Game of Life on a 48 x 30 torus that steps ten times
// a second, each generation one datastar-patch-elements event that replaces
// #sim-view. sw.js serves it as an SSE response; live.js uses the same
// frames when the page has no Service Worker. A classic script, so the
// Service Worker can load it with importScripts.
;(function (self) {
    const COLS = 48
    const ROWS = 30
    const EVERY = 100 // ms between generations

    // A small generator, so every stream of a run shows the same boards.
    const random = (seed) => () => {
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }

    function board(seed) {
        const next = random(seed)
        const cells = new Uint8Array(COLS * ROWS)
        for (let i = 0; i < cells.length; i++) cells[i] = next() < 0.3 ? 1 : 0
        return { cells, next, gen: 0 }
    }

    // step advances the board one generation; every 50 it drops a few
    // gliders in, so the board never settles.
    function step(b) {
        const { cells } = b
        const out = new Uint8Array(cells.length)
        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                let n = 0
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx || dy) n += cells[((y + dy + ROWS) % ROWS) * COLS + ((x + dx + COLS) % COLS)]
                    }
                }
                const alive = cells[y * COLS + x]
                out[y * COLS + x] = n === 3 || (alive && n === 2) ? 1 : 0
            }
        }
        b.cells = out
        b.gen++
        if (b.gen % 50 === 0) {
            for (let g = 0; g < 4; g++) {
                const x = Math.floor(b.next() * COLS)
                const y = Math.floor(b.next() * ROWS)
                for (const [dx, dy] of [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]]) {
                    out[((y + dy) % ROWS) * COLS + ((x + dx) % COLS)] = 1
                }
            }
        }
    }

    // html renders the board as the view #sim-view: an SVG path of the live
    // cells, with the generation and the time it was made.
    function html(b, madeAt) {
        let d = ''
        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                if (b.cells[y * COLS + x]) d += `M${x} ${y}h1v1h-1z`
            }
        }
        return `<div id="sim-view" data-gen="${b.gen}" data-made="${madeAt}"><svg viewBox="0 0 ${COLS} ${ROWS}" role="img" aria-label="Generation ${b.gen}"><path d="${d}"/></svg></div>`
    }

    // event encodes a frame as Datastar's SSE event.
    const event = (elements) => `event: datastar-patch-elements\ndata: elements ${elements}\n\n`

    self.NewestFrameLife = { COLS, ROWS, EVERY, board, step, html, event }
})(self)
