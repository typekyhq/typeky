// A "Slow 4G" proxy for measuring a page as a real user would load it.
//
//   pnpm dev                     # in one terminal
//   node scripts/throttle-proxy.mjs   # in another
//   open http://localhost:8789/admin/pages
//
// Then read window.__edit.ready, which is milliseconds from navigation start to
// the editor being attached. See architecture section 3.11 for the budget it
// checks against, and internal/04 for the measurements taken with it.
//
// Why a proxy and not DevTools throttling: the browser automation available here
// does not expose a throttle, and a number computed from byte counts is a
// projection rather than a measurement. Cookies ignore the port and the HTTP
// cache does not, which is what lets this serve a cold page with a live session.
//
// Chrome DevTools calls it Slow 4G: 1.6 Mbit/s down, 150 ms round trip. Those
// are also Lighthouse's numbers, so the measurement is comparable to the one the
// acceptance criterion was written against.
//
// It listens on a different port on purpose. Cookies ignore the port, so the
// session from 8787 comes along, while the HTTP cache is keyed by origin and
// therefore starts empty here -- which is what makes this a cold load.
//
// A token bucket is shared across responses rather than applied per response,
// because concurrent requests share one pipe; throttling each one separately
// would let the page download faster than the network it claims to model.

import { createServer, request } from 'node:http'
import { gunzipSync, brotliDecompressSync } from 'node:zlib'

const UPSTREAM_HOST = '127.0.0.1'
const UPSTREAM_PORT = 8787
// A fresh port, so the origin -- and with it the HTTP cache -- starts empty.
const PORT = 8790

const DOWNLOAD_BYTES_PER_SECOND = (1.6 * 1000 * 1000) / 8 // 1.6 Mbit/s
const ROUND_TRIP_MS = 150

let bytesPaced = 0
let pacingStartedAt = Date.now()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Restarts the clock for each page load.
 *
 * The accumulated allowance has to be reset with it. Without that, idle time
 * between runs builds up credit and the first request of a page gets a free
 * burst -- a proxy that had been sitting still for half a minute would let the
 * whole page through unthrottled and report a convincing, wrong number.
 */
function startNewPageClock() {
  bytesPaced = 0
  pacingStartedAt = Date.now()
}

async function pace(bytes) {
  bytesPaced += bytes
  const scheduledAt = (bytesPaced / DOWNLOAD_BYTES_PER_SECOND) * 1000
  const elapsed = Date.now() - pacingStartedAt
  if (scheduledAt > elapsed) await sleep(Math.round(scheduledAt - elapsed))
}

/** Records when the editor is actually attached, as milliseconds since navigation start. */
const MARKER = `<script>
window.__edit = { ready: null };
new MutationObserver(function () {
  if (window.__edit.ready === null && document.querySelector('.ProseMirror')) {
    window.__edit.ready = performance.now();
  }
}).observe(document.documentElement, { childList: true, subtree: true });
</script>`

function decodeBody(buffer, encoding) {
  if (encoding === 'gzip') return gunzipSync(buffer)
  if (encoding === 'br') return brotliDecompressSync(buffer)
  return buffer
}

const server = createServer(async (clientRequest, clientResponse) => {
  if (String(clientRequest.headers.accept ?? '').includes('text/html')) {
    startNewPageClock()
  }

  await sleep(ROUND_TRIP_MS)

  const headers = { ...clientRequest.headers, host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}` }

  const upstreamRequest = request(
    {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: clientRequest.method,
      path: clientRequest.url,
      headers,
    },
    async (upstreamResponse) => {
      const responseHeaders = { ...upstreamResponse.headers }
      const encoding = upstreamResponse.headers['content-encoding']
      const contentType = String(responseHeaders['content-type'] ?? '')

      delete responseHeaders['content-length']
      delete responseHeaders['transfer-encoding']

      const chunks = []
      for await (const chunk of upstreamResponse) chunks.push(chunk)
      let body = Buffer.concat(chunks)

      if (contentType.includes('text/html')) {
        // Decompressed only to mark it up. Bandwidth is counted on the wire, so
        // everything else keeps whichever encoding the origin chose -- Cloudflare
        // serves brotli, and pacing the uncompressed size would model a network
        // considerably slower than the one being measured.
        const decoded = decodeBody(body, String(encoding ?? ''))
        body = Buffer.from(decoded.toString('utf8').replace('</head>', `${MARKER}</head>`))
        delete responseHeaders['content-encoding']
      }

      responseHeaders['content-length'] = String(body.length)
      clientResponse.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders)

      const STEP = 16 * 1024
      for (let offset = 0; offset < body.length; offset += STEP) {
        const slice = body.subarray(offset, offset + STEP)
        await pace(slice.length)
        clientResponse.write(slice)
      }
      clientResponse.end()
    },
  )

  upstreamRequest.on('error', () => {
    clientResponse.writeHead(502)
    clientResponse.end('upstream failed')
  })

  clientRequest.pipe(upstreamRequest)
})

server.listen(PORT, () => console.log(`throttled proxy on http://localhost:${PORT} -> ${UPSTREAM_PORT}`))
