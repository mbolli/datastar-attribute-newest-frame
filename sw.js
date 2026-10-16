// The demo's server: this Service Worker answers demo/stream with an SSE
// response, so Datastar's own fetch and reader take the frames. It writes a
// generation every 100 ms whether or not the page reads them, as a server
// does, and what the page has not read yet waits in the browser. A stream
// ends after ?seconds=, or when the page posts {stop: run}: the page never
// aborts the request, which Firefox would log as an error. A page loaded
// past the worker (a hard reload) posts {claim: true} to be controlled.
importScripts('demo/life.js')

const streams = new Map() // run -> end()

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('message', (e) => {
    if (e.data?.claim) e.waitUntil(self.clients.claim())
    streams.get(e.data?.stop)?.()
})

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url)
    if (url.origin !== self.location.origin || !url.pathname.endsWith('/demo/stream')) return
    const q = url.searchParams
    e.respondWith(stream(q.get('run') || '', Number(q.get('seed')) || 1, Math.min(Number(q.get('seconds')) || 20, 120)))
})

function stream(run, seed, seconds) {
    const { board, step, html, event, EVERY } = self.NewestFrameLife
    const encoder = new TextEncoder()
    const b = board(seed)
    let timer = 0
    let end = () => {}
    const body = new ReadableStream({
        start(controller) {
            const start = Date.now()
            end = () => {
                clearTimeout(timer)
                streams.delete(run)
                try {
                    controller.close()
                } catch {}
            }
            streams.set(run, end)
            const write = () => {
                const now = Date.now()
                if (now - start >= seconds * 1000) return end()
                try {
                    controller.enqueue(encoder.encode(event(html(b, now))))
                } catch {
                    return end() // the page went away
                }
                step(b)
                timer = setTimeout(write, Math.max(0, start + b.gen * EVERY - Date.now()))
            }
            write()
        },
        cancel() {
            end()
        },
    })
    return new Response(body, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' },
    })
}
