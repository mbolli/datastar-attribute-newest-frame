// The live demo on index.html. It streams the Game of Life of demo/life.js
// into #sim-view, without and with data-newest-frame, and measures how far
// behind the board the page falls. sw.js serves the stream, so Datastar's own
// fetch and reader take the frames; where no Service Worker can run, the
// page dispatches the frames itself, as Datastar's reader would.
import { action, getPath, mergePaths } from 'datastar'

const { board, step, html, EVERY } = self.NewestFrameLife
const RUN = 12 // seconds a run lasts
const SIM = /^sim-(with|without)$/

const blank = () => ({ points: [], received: 0, applied: 0, painted: 0, pause: 0, end: 0, max: 0, done: false })
const runs = { without: blank(), with: blank() }
let current = null // the run in progress: { mode, id, el, t0, stats, shown, lastPaint }
let sequence = 0 // bumped by stop, so a pending second run does not start
let source = 'none' // 'worker' or 'page', once the stream is ready
const seed = 1 + Math.floor(Math.random() * 1000)

// This capture listener runs before the plugin's: it counts the frames the
// page receives, and drops what is left of a run's stream once the run is
// over, also in the middle of a chunk, so a run ends on time.
const seen = new WeakSet()
addEventListener('datastar-fetch', (e) => {
    const d = e.detail
    if (d?.type !== 'datastar-patch-elements' || !SIM.test(d.el?.id)) return
    if (!d.el.isConnected || (current && Date.now() - current.t0 > RUN * 1000)) {
        e.stopImmediatePropagation()
        return
    }
    if (!seen.has(d)) {
        seen.add(d)
        if (current) current.stats.received++
    }
}, true)

// After Datastar applied a frame, the page busy-waits the frame's cost.
document.addEventListener('datastar-fetch', (e) => {
    const d = e.detail
    if (!current || d?.type !== 'datastar-patch-elements' || !SIM.test(d.el?.id)) return
    current.stats.applied++
    const until = performance.now() + (Number(getPath('_demo.cost')) || 0)
    while (performance.now() < until) {}
})

// lag is how long ago the board passed the generation made at `made`.
const lag = (made, t) => Math.max(0, t - made - EVERY) / 1000

// paint runs before each paint while a run lasts: it counts the frames that
// reach the screen and samples the lag, twice when the frame changed, so the
// chart shows the old frame aging until the new one replaces it.
function paint(now) {
    if (!current) return
    const c = current
    const s = c.stats
    const t = Date.now()
    if (c.lastPaint) s.pause = Math.max(s.pause, now - c.lastPaint)
    c.lastPaint = now
    const view = document.getElementById('sim-view')
    const made = Number(view?.dataset.made) || 0
    const x = (t - c.t0) / 1000
    if (made >= c.t0 && made !== c.shown) {
        if (c.shown) {
            const old = lag(c.shown, t) // how old the frame on screen got
            s.points.push([x, old])
            s.max = Math.max(s.max, old)
        }
        c.shown = made
        s.painted++
    }
    if (c.shown) {
        const y = lag(c.shown, t)
        const last = s.points[s.points.length - 1]
        if (!last || x - last[0] > 0.05 || last[1] !== y) s.points.push([x, y])
        s.max = Math.max(s.max, y)
        if (now - c.shownAt > 200 || !c.shownAt) {
            c.shownAt = now
            mergePaths([['_demo', { gen: `Generation ${view.dataset.gen},`, behind: `${y.toFixed(2)} s behind.` }]])
            showRuns()
        }
    }
    if (now - c.drawnAt > 100 || !c.drawnAt) {
        c.drawnAt = now
        draw()
    }
    requestAnimationFrame(paint)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// run streams one run in mode 'with' or 'without' for RUN seconds.
async function run(mode, n) {
    const id = `${mode}-${Date.now()}`
    runs[mode] = blank()
    showRuns()
    document.getElementById('sim-view').outerHTML = '<div id="sim-view"><svg viewBox="0 0 48 30" role="img" aria-label="The board, before a run"><path d=""/></svg></div>'
    const el = document.createElement('div')
    el.id = `sim-${mode}`
    el.hidden = true
    if (source === 'worker') {
        el.setAttribute('data-init', `@get('demo/stream?run=${id}&seed=${seed}&seconds=${RUN + 5}', {openWhenHidden: true})`)
    }
    current = { mode, id, el, t0: Date.now(), stats: runs[mode], shown: 0, lastPaint: 0, shownAt: 0, drawnAt: 0 }
    mergePaths([['_demo', { status: `Running ${mode} the plugin, ${RUN} s.`, event: '' }]])
    document.getElementById('demo').append(el)
    if (source === 'page') pageStream(el)
    requestAnimationFrame(paint)
    await sleep(RUN * 1000)
    if (n !== sequence || current?.id !== id) return false
    stopStream()
    return true
}

// stopStream ends the current run: the stream ends where it is made, and the
// page drops what it has not applied yet.
function stopStream() {
    const c = current
    if (!c) return
    navigator.serviceWorker?.controller?.postMessage({ stop: c.id })
    c.el.remove()
    const s = c.stats
    s.end = c.shown ? lag(c.shown, Date.now()) : 0
    s.max = Math.max(s.max, s.end)
    if (c.shown) s.points.push([(Date.now() - c.t0) / 1000, s.end])
    s.done = true
    current = null
    showRuns()
    draw()
}

function showRuns() {
    const text = (s) => s.done || s === current?.stats
        ? {
            applied: `${s.applied}`,
            painted: `${s.painted}`,
            skipped: `${Math.max(0, s.received - s.applied)}`,
            pause: `${(s.pause / 1000).toFixed(2)} s`,
            end: s.done ? `${s.end.toFixed(2)} s` : '',
            max: `${s.max.toFixed(2)} s`,
        }
        : { applied: '', painted: '', skipped: '', pause: '', end: '', max: '' }
    mergePaths([['_runs', { without: text(runs.without), with: text(runs.with) }]])
}

action({
    name: 'newestFrameDemo',
    apply: async (_ctx, command) => {
        if (command === 'stop') {
            sequence++
            stopStream()
            mergePaths([['_demo', { busy: false, status: 'Stopped.' }]])
            return
        }
        if (getPath('_demo.busy') || source === 'none') return
        const n = ++sequence
        mergePaths([['_demo.busy', true]])
        const modes = command === 'both' ? ['without', 'with'] : [getPath('_demo.plugin') ? 'with' : 'without']
        for (const [i, mode] of modes.entries()) {
            if (i) {
                mergePaths([['_demo.status', 'Letting the page settle.']])
                await sleep(1000)
                if (n !== sequence) return
            }
            if (!(await run(mode, n))) return
            await sleep(400)
            showRuns()
        }
        mergePaths([['_demo', { busy: false, status: 'Done. Change the cost and run again.' }]])
    },
})

// pageStream stands in for Datastar's reader where no Service Worker runs:
// a read takes every frame made since the last one, and dispatches them all
// in one task, as Datastar does with a chunk.
async function pageStream(el) {
    const b = board(seed)
    const start = Date.now()
    while (el.isConnected && Date.now() - start < (RUN + 5) * 1000) {
        const due = Math.floor((Date.now() - start) / EVERY) + 1
        while (b.gen < due && el.isConnected) {
            const elements = html(b, start + b.gen * EVERY)
            document.dispatchEvent(new CustomEvent('datastar-fetch', { detail: { type: 'datastar-patch-elements', el, argsRaw: { elements } } }))
            step(b)
        }
        await Promise.resolve()
        await sleep(Math.max(0, start + b.gen * EVERY - Date.now()))
    }
}

// The chart: seconds behind over the seconds of a run, one line per mode.
const canvas = document.getElementById('lag-chart')
const tip = document.querySelector('.chart .tip')
const pad = { l: 48, r: 14, t: 8, b: 26 }
let hover = null // seconds into the run under the pointer

// runSeconds is the x axis's end: a run, or longer when a freeze held its end.
function runSeconds() {
    let x = RUN
    for (const r of Object.values(runs)) for (const [px] of r.points) x = Math.max(x, px)
    return Math.ceil(x)
}

// ticks returns the y axis's step and end: at most 4 steps of a round size.
function ticks(top) {
    for (const step of [0.25, 0.5, 1, 2, 5, 10, 20, 30, 60]) {
        const end = Math.max(step, Math.ceil(top / step) * step)
        if (end / step <= 4) return { step, end }
    }
    return { step: 60, end: Math.ceil(top / 60) * 60 }
}

function draw() {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return
    const dpr = devicePixelRatio || 1
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    const style = getComputedStyle(canvas.parentElement)
    const keys = document.querySelectorAll('.chart .key')
    const color = { without: getComputedStyle(keys[0]).backgroundColor, with: getComputedStyle(keys[1]).backgroundColor }
    const muted = style.color
    const grid = style.borderTopColor
    const surface = getComputedStyle(document.querySelector('#demo')).backgroundColor
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono')

    const xMax = runSeconds()
    let yTop = 0
    for (const r of Object.values(runs)) for (const [, y] of r.points) yTop = Math.max(yTop, y)
    const { step: yStep, end: yMax } = ticks(Math.max(yTop * 1.05, 0.2))
    const px = (x) => pad.l + (x / xMax) * (w - pad.l - pad.r)
    const py = (y) => pad.t + (1 - y / yMax) * (h - pad.t - pad.b)

    ctx.font = `11px ${mono}`
    ctx.lineWidth = 1
    ctx.strokeStyle = grid
    ctx.fillStyle = muted
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let y = 0; y <= yMax + 1e-9; y += yStep) {
        ctx.beginPath()
        ctx.moveTo(pad.l, Math.round(py(y)) + 0.5)
        ctx.lineTo(w - pad.r, Math.round(py(y)) + 0.5)
        ctx.stroke()
        ctx.fillText(`${+y.toFixed(2)} s`, pad.l - 6, py(y))
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const xStep = w < 420 ? 4 : 2
    for (let x = 0; x <= xMax; x += xStep) ctx.fillText(`${x} s`, px(x), h - pad.b + 8)

    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    for (const mode of ['without', 'with']) {
        const pts = runs[mode].points
        if (!pts.length) continue
        ctx.strokeStyle = color[mode]
        ctx.beginPath()
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))))
        ctx.stroke()
        const [x, y] = pts[pts.length - 1]
        ctx.beginPath()
        ctx.arc(px(x), py(y), 4, 0, Math.PI * 2)
        ctx.fillStyle = color[mode]
        ctx.strokeStyle = surface
        ctx.lineWidth = 2
        ctx.fill()
        ctx.stroke()
    }

    tip.hidden = hover === null
    if (hover === null) return
    ctx.strokeStyle = muted
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(Math.round(px(hover)) + 0.5, pad.t)
    ctx.lineTo(Math.round(px(hover)) + 0.5, h - pad.b)
    ctx.stroke()
    const rows = [`<p>${hover.toFixed(1)} s into the run</p>`]
    for (const mode of ['without', 'with']) {
        const y = at(runs[mode].points, hover)
        if (y !== null) rows.push(`<p><span class="key${mode === 'with' ? ' key-with' : ''}"></span>${mode}: ${y.toFixed(2)} s behind</p>`)
    }
    tip.innerHTML = rows.join('')
    const xh = px(hover)
    const tw = tip.offsetWidth
    tip.style.left = `${xh + 12 + tw > w ? Math.max(0, xh - 12 - tw) : xh + 12}px`
    tip.style.top = `${canvas.offsetTop + pad.t}px`
}

// at returns the lag of a run at x seconds, or null outside it.
function at(points, x) {
    if (!points.length || x < points[0][0] || x > points[points.length - 1][0]) return null
    let y = points[0][1]
    for (const [px, py] of points) {
        if (px > x) break
        y = py
    }
    return y
}

canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect()
    const x = e.clientX - r.left
    hover = x < pad.l || x > r.width - pad.r ? null : ((x - pad.l) / (r.width - pad.l - pad.r)) * runSeconds()
    draw()
})
canvas.addEventListener('pointerleave', () => {
    hover = null
    draw()
})
new ResizeObserver(() => draw()).observe(canvas)
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => draw())

// The stream's source: the Service Worker when it controls this page, else
// the page itself. ?stream=page forces the page's own.
async function ready() {
    const say = (text) => mergePaths([['_demo.source', text]])
    const page = () => {
        source = 'page'
        say("Simulated in the page, since no Service Worker serves it here: the page dispatches each frame as a datastar-fetch event, all frames made since the last read in one task, as Datastar's reader does with a chunk.")
    }
    if (new URLSearchParams(location.search).get('stream') === 'page' || !('serviceWorker' in navigator)) return page()
    try {
        const reg = await navigator.serviceWorker.register('sw.js')
        await navigator.serviceWorker.ready
        if (!navigator.serviceWorker.controller) {
            reg.active?.postMessage({ claim: true })
            await Promise.race([
                new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })),
                sleep(3000),
            ])
        }
        if (!navigator.serviceWorker.controller) return page()
        source = 'worker'
        say("A real SSE stream: a Service Worker in this page writes the frames, and Datastar's own fetch and reader parse them. The browser hands the page everything that waited at each read, in Firefox too, as Chromium does over the network.")
    } catch {
        page()
    }
}
ready()
draw()
