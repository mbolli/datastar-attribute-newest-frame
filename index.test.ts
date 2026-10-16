// Tests for the newest-frame plugin: a fake Datastar listener on document
// applies what the plugin lets through, a fake clock stands in for
// performance.now, and paint() runs the queued animation frames.
import { test, mock, after } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert'
import { JSDOM } from 'jsdom'
import newestFramePlugin, { BEHIND_EVENT, wholeTarget } from './index.js'
import type { NewestFrameBehind } from './index.js'

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="stream"></div><div id="feed"></div><div id="other"></div></body></html>', { pretendToBeVisual: true })
const g = globalThis as any
g.window = dom.window
g.document = dom.window.document
g.CustomEvent = dom.window.CustomEvent
// pretendToBeVisual makes the page visible, and runs a timer until closed.
after(() => dom.window.close())

let clock = 0
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true })

let rafs = new Map<number, () => void>()
let rafId = 0
g.requestAnimationFrame = (f: () => void) => {
    rafs.set(++rafId, f)
    return rafId
}
g.cancelAnimationFrame = (id: number) => rafs.delete(id)
const paint = () => {
    const due = rafs
    rafs = new Map()
    for (const f of due.values()) f()
}

// Datastar's listener: what reaches it is applied. cost is the ms each
// element patch takes to apply.
type Detail = { type: string; el: Element; argsRaw: Record<string, string> }
let applied: Detail[] = []
let cost = 0
document.addEventListener('datastar-fetch', (e) => {
    const d = (e as CustomEvent<Detail>).detail
    applied.push(d)
    if (d.type === 'datastar-patch-elements') clock += cost
})

const byId = (id: string) => document.getElementById(id)!
const dispatch = (detail: Detail) => document.dispatchEvent(new CustomEvent('datastar-fetch', { detail }))
const frame = (elements: string, el: Element = byId('stream'), args: Record<string, string> = {}) =>
    dispatch({ type: 'datastar-patch-elements', el, argsRaw: { elements, ...args } })
const signals = (s: string, el: Element = byId('stream')) =>
    dispatch({ type: 'datastar-patch-signals', el, argsRaw: { signals: s } })
// Datastar reads the next chunk after an await: the plugin's flush runs then.
const endOfChunk = () => new Promise<void>((resolve) => queueMicrotask(resolve))
const shown = () => applied.map((d) => d.argsRaw.elements ?? d.argsRaw.signals)

type Setup = { key?: string; reopen?: boolean; slow?: boolean }
// start applies the plugin for one test, which removes it when it ends.
const start = (t: TestContext, { key, reopen = false, slow = false }: Setup = {}) => {
    applied = []
    cost = 0
    clock = 10_000
    rafs = new Map()
    const merged: [string, any][] = []
    const signalsSet: Record<string, unknown> = { _slow: slow }
    const plugin = newestFramePlugin(
        (path) => signalsSet[path],
        (paths) => {
            for (const [p, v] of paths) signalsSet[p] = v
            merged.push(...paths)
        },
    )
    const mods = new Map<string, Set<string>>(reopen ? [['reopen', new Set()]] : [])
    const cleanup = plugin.apply({ el: document.body, key, mods, rawKey: 'newest-frame', error: () => new Error() } as any)
    const events: NewestFrameBehind[] = []
    const onBehind = (e: Event) => events.push((e as CustomEvent<NewestFrameBehind>).detail)
    document.addEventListener(BEHIND_EVENT, onBehind)
    let stopped = false
    const stop = () => {
        if (stopped) return
        stopped = true
        if (cleanup) cleanup()
        document.removeEventListener(BEHIND_EVENT, onBehind)
    }
    t.after(stop)
    return { merged, events, stop }
}

test('newestFramePlugin returns an AttributePlugin object', () => {
    const plugin = newestFramePlugin(() => undefined, () => {})
    assert.strictEqual(plugin.name, 'newest-frame')
    assert.deepStrictEqual(plugin.requirement, { key: 'allowed', value: 'denied' })
    assert.strictEqual(typeof plugin.apply, 'function')
})

test('a page that keeps up applies every frame at once', async (t) => {
    start(t)
    for (let i = 1; i <= 3; i++) {
        clock += 100
        frame(`<div id="life">${i}</div>`)
        assert.strictEqual(applied.length, i - 1, 'held until the chunk is parsed')
        await endOfChunk()
        assert.strictEqual(applied.length, i, 'applied after the chunk')
        paint()
    }
})

test('the newest frame of a view wins, and the order is kept', async (t) => {
    start(t)
    frame('<div id="life">1</div>')
    await endOfChunk()
    // A second chunk before the next paint waits for it.
    frame('<div id="life">2</div>')
    signals('{"a":1}')
    frame('<div id="life">3</div>')
    frame('<p>no id</p>')
    frame('<p>no id 2</p>')
    await endOfChunk()
    assert.deepStrictEqual(shown(), ['<div id="life">1</div>'])
    paint()
    assert.deepStrictEqual(shown(), ['<div id="life">1</div>', '{"a":1}', '<div id="life">3</div>', '<p>no id</p>', '<p>no id 2</p>'])
})

test('elements with the same top-level ids are one view, in any order', async (t) => {
    start(t)
    frame('<div id="a"></div><div id="b"><div id="b2"></div></div>')
    frame('<div id="b"></div><div id="a"></div>')
    frame('<div id="a"></div>')
    await endOfChunk()
    assert.deepStrictEqual(shown(), ['<div id="b"></div><div id="a"></div>', '<div id="a"></div>'])
})

test('signal patches, appends and other modes are never dropped', async (t) => {
    start(t)
    signals('{"n":1}')
    signals('{"n":2}')
    frame('<li id="x">1</li>', byId('stream'), { mode: 'append', selector: '#list' })
    frame('<li id="x">2</li>', byId('stream'), { mode: 'append', selector: '#list' })
    frame('<li id="y">1</li>', byId('stream'), { mode: 'prepend', selector: '#list' })
    frame('<li id="y">2</li>', byId('stream'), { mode: 'prepend', selector: '#list' })
    frame('', byId('stream'), { mode: 'remove', selector: '#gone' })
    frame('', byId('stream'), { mode: 'remove', selector: '#gone' })
    frame('<div id="s"><script>1</script></div>')
    frame('<div id="s"><script>2</script></div>')
    frame('<div id="v">1</div>', byId('stream'), { useViewTransition: 'true' })
    frame('<div id="v">2</div>', byId('stream'), { useViewTransition: 'true' })
    await endOfChunk()
    assert.strictEqual(applied.length, 12)
    assert.deepStrictEqual(shown().slice(0, 2), ['{"n":1}', '{"n":2}'])
})

test('events of other elements, and other events of the stream, pass at once', (t) => {
    start(t)
    frame('<div id="x"></div>', byId('other'))
    assert.strictEqual(applied.length, 1)
    dispatch({ type: 'started', el: byId('stream'), argsRaw: {} })
    assert.strictEqual(applied.length, 2)
    assert.strictEqual(rafs.size, 0)
})

test('the stream is the element named after the colon', async (t) => {
    start(t, { key: 'feed' })
    frame('<div id="life">1</div>', byId('feed'))
    frame('<div id="life">2</div>', byId('feed'))
    frame('<div id="life">a</div>')
    frame('<div id="life">b</div>')
    assert.deepStrictEqual(shown(), ['<div id="life">a</div>', '<div id="life">b</div>'], 'the element #stream passes')
    await endOfChunk()
    assert.deepStrictEqual(shown().slice(2), ['<div id="life">2</div>'])
})

test('the events of a detached stream element are dropped', async (t) => {
    start(t)
    const old = document.createElement('div')
    old.id = 'stream'
    frame('<div id="life"></div>', old)
    signals('{"a":1}', old)
    await endOfChunk()
    paint()
    assert.strictEqual(applied.length, 0)
})

test('after a batch, the next waits half the time that batch took to apply', async (t) => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
        start(t)
        cost = 40
        frame('<div id="life">1</div>')
        await endOfChunk()
        assert.strictEqual(applied.length, 1)
        paint()
        clock += 10 // 10 ms after the batch that took 40
        frame('<div id="life">2</div>')
        await endOfChunk()
        assert.strictEqual(applied.length, 1, 'held for 20 ms after the batch')
        frame('<div id="life">3</div>')
        await endOfChunk()
        clock += 10
        mock.timers.tick(10)
        assert.deepStrictEqual(shown(), ['<div id="life">1</div>', '<div id="life">3</div>'])
    } finally {
        mock.timers.reset()
    }
})

// run sends one frame of one view every `every` ms and paints after each
// frame for which paintAfter is true, n frames or until done. It returns
// the ms it ran.
const run = async (n: number, every: number, paintAfter: (i: number) => boolean, done = () => false) => {
    const t0 = clock
    for (let i = 0; i < n && !done(); i++) {
        clock += every
        frame('<div id="life"></div>')
        await endOfChunk()
        if (paintAfter(i)) paint()
    }
    paint()
    return clock - t0
}
const everyFrame = () => true
const oneOfThreeSkipped = (i: number) => i % 3 !== 1
const twoOfThreeSkipped = (i: number) => i % 3 === 2

test('a page that keeps up is never reported behind', async (t) => {
    const { merged, events } = start(t, { reopen: true })
    await run(60, 100, everyFrame)
    assert.strictEqual(applied.length, 60)
    assert.strictEqual(events.length, 0)
    assert.strictEqual(merged.length, 0)
})

test('a third of the frames skipped is not behind', async (t) => {
    const { events } = start(t)
    await run(100, 100, oneOfThreeSkipped)
    assert.ok(applied.length > 60 && applied.length < 75, `${applied.length} of 100 applied`)
    assert.strictEqual(events.length, 0)
})

test('two thirds skipped of fewer than 10 frames in 3 s is not behind', async (t) => {
    const { events } = start(t)
    // No paint: after a second without one, the batch goes anyway.
    await run(40, 350, () => false)
    assert.ok(applied.length < 16, `${applied.length} of 40 applied`)
    assert.strictEqual(events.length, 0)
})

test('more than half skipped: newest-frame-behind on the stream, again after another span', async (t) => {
    const { merged, events } = start(t)
    const stream = byId('stream')
    let target: EventTarget | null = null
    stream.addEventListener(BEHIND_EVENT, (e) => (target = e.target), { once: true })
    const took = await run(200, 100, twoOfThreeSkipped, () => events.length > 0)
    assert.strictEqual(events.length, 1)
    assert.strictEqual(target, stream)
    const [e] = events
    assert.strictEqual(e.id, 'stream')
    assert.strictEqual(e.reopen, false)
    assert.ok(e.frames >= 10 && e.skipped / e.frames > 0.5, JSON.stringify(e))
    assert.ok(e.span >= 2700 && e.span <= 3000, JSON.stringify(e))
    assert.ok(took <= 3500, `${took} ms`)
    assert.strictEqual(merged.length, 0, 'no signal set')
    assert.strictEqual(byId('stream'), stream, 'the stream stays')
    const again = await run(200, 100, twoOfThreeSkipped, () => events.length > 1)
    assert.strictEqual(events.length, 2, 'once more after another span')
    assert.ok(again >= 2700 && again <= 3500, `${again} ms later`)
})

test('__reopen sets $_slow and opens the stream again, once', async (t) => {
    const { merged, events } = start(t, { reopen: true })
    const old = byId('stream')
    await run(200, 100, twoOfThreeSkipped, () => events.length > 0)
    assert.strictEqual(events.length, 1)
    assert.strictEqual(events[0].reopen, true)
    assert.deepStrictEqual(merged, [['_slow', true]])
    assert.notStrictEqual(byId('stream'), old, 'a copy replaced the element')
    assert.strictEqual(old.isConnected, false)
    applied = []
    frame('<div id="life">old</div>', old)
    await endOfChunk()
    paint()
    assert.strictEqual(applied.length, 0, 'what the old request still delivers is dropped')
    await run(200, 100, twoOfThreeSkipped)
    assert.strictEqual(events.length, 1, 'it asks once')
    assert.strictEqual(merged.length, 1)
})

test('__reopen never asks when $_slow is already true', async (t) => {
    const { merged, events } = start(t, { reopen: true, slow: true })
    const old = byId('stream')
    await run(200, 100, twoOfThreeSkipped)
    assert.strictEqual(events.length, 0)
    assert.strictEqual(merged.length, 0)
    assert.strictEqual(byId('stream'), old)
})

test('cleanup removes the listener and drops what waits', async (t) => {
    const { stop } = start(t)
    frame('<div id="life">1</div>')
    await endOfChunk()
    frame('<div id="life">2</div>')
    await endOfChunk()
    stop()
    paint()
    assert.deepStrictEqual(shown(), ['<div id="life">1</div>'])
    frame('<div id="life">3</div>')
    assert.strictEqual(applied.length, 2, 'passes at once without the plugin')
})

test('wholeTarget names what a patch replaces wholly', () => {
    const cases: [Record<string, string>, string][] = [
        [{ elements: '<div id="a">x</div>' }, 'outer html a'],
        [{ elements: '<div id="b"></div><div id="a"></div>' }, 'outer html a b'],
        [{ elements: '<div id=a><p>x<p>y</div>' }, 'outer html a'],
        [{ elements: '<!-- c --><img id="i"><br id=\'r\'/>' }, 'outer html i r'],
        [{ elements: '<div id="a"></div>', mode: 'replace' }, 'replace html a'],
        [{ elements: '<div id="a"></div>', selector: '#a' }, 'outer html a'],
        [{ elements: '<circle id="c"/>', namespace: 'svg' }, 'outer svg c'],
        [{ elements: '<p>x</p>', mode: 'inner', selector: '#a' }, 'inner html a'],
        [{ elements: '<body><p>x</p></body>' }, 'outer html <body>'],
        [{ elements: '<div>x</div>' }, ''],
        [{ elements: '<div id="a"></div><p>x</p>' }, ''],
        [{ elements: '<div id="a">' }, ''],
        [{ elements: '</div>' }, ''],
        [{ elements: '<div id="a"></div>', selector: '#b' }, ''],
        [{ elements: '<div id="a"></div>', selector: '.a' }, ''],
        [{ elements: '<p>x</p>', mode: 'inner' }, ''],
        [{ elements: '<li id="a"></li>', mode: 'append', selector: '#l' }, ''],
        [{ elements: '<li id="a"></li>', mode: 'after', selector: '#l' }, ''],
        [{ elements: '<div id="a"><script>x()</script></div>' }, ''],
        [{ elements: '<div id="a"></div>', useViewTransition: 'true' }, ''],
        [{ signals: '{}' }, ''],
    ]
    for (const [args, want] of cases) {
        assert.strictEqual(wholeTarget(args), want, JSON.stringify(args))
    }
})
