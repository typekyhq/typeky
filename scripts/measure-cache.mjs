#!/usr/bin/env node
/**
 * Measures what a cache hit costs.
 *
 * The acceptance for the edge-cache slice is "P95 under 200 ms on a hit", and a
 * number like that is only worth quoting if it can be reproduced. This script
 * warms each path, then times it, and reports the percentiles together with the
 * hit ratio -- because a fast number from a run that missed most of the time
 * would be a number about the renderer, not about the cache.
 *
 * What it does not measure: a deployed Worker. `wrangler dev` is Node talking to
 * Miniflare on the same machine, so the figure below is a floor rather than a
 * prediction -- it contains no network at all. A production P95 belongs to a
 * deployment, and that is a later slice's job.
 *
 * Usage:
 *   node scripts/measure-cache.mjs
 *   node scripts/measure-cache.mjs --requests 200 --paths /,/posts,/posts/hello
 */

const DEFAULTS = {
  base: 'http://localhost:8787',
  requests: 60,
  paths: ['/', '/posts', '/posts/hello-typeky', '/products', '/products/starter-widget'],
  warmup: 3,
}

function parseArgs(argv) {
  const options = { ...DEFAULTS }

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]

    if (flag === '--base' && value !== undefined) options.base = value
    if (flag === '--requests' && value !== undefined) options.requests = Number(value)
    if (flag === '--paths' && value !== undefined) options.paths = value.split(',')
    if (flag === '--warmup' && value !== undefined) options.warmup = Number(value)
  }

  return options
}

/** The percentile by nearest rank, which is what a P95 means without hedging. */
function percentile(samples, fraction) {
  const sorted = [...samples].sort((left, right) => left - right)
  const rank = Math.ceil(fraction * sorted.length)
  return sorted[Math.min(Math.max(rank - 1, 0), sorted.length - 1)]
}

function summarize(samples) {
  return {
    count: samples.length,
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    max: Math.max(...samples),
  }
}

function milliseconds(value) {
  return `${value.toFixed(1)} ms`
}

async function timeOnce(url) {
  const started = performance.now()
  const response = await fetch(url)

  // The body has to be read, or the time measured is the time to the headers and
  // a stream that was never consumed looks free.
  await response.arrayBuffer()

  return {
    milliseconds: performance.now() - started,
    outcome: response.headers.get('x-typeky-cache') ?? 'unknown',
    status: response.status,
  }
}

const options = parseArgs(process.argv.slice(2))

const all = []
let misses = 0

console.log(`measuring ${String(options.requests)} requests per path against ${options.base}`)
console.log('')

for (const path of options.paths) {
  const url = `${options.base}${path}`

  for (let index = 0; index < options.warmup; index += 1) await timeOnce(url)

  const samples = []
  let hits = 0

  for (let index = 0; index < options.requests; index += 1) {
    const result = await timeOnce(url)
    samples.push(result.milliseconds)
    all.push(result.milliseconds)
    if (result.outcome === 'hit') hits += 1
    if (result.outcome === 'miss') misses += 1
  }

  const summary = summarize(samples)
  console.log(
    `${path.padEnd(28)} hits ${String(hits)}/${String(options.requests)}  ` +
      `p50 ${milliseconds(summary.p50).padEnd(9)} p95 ${milliseconds(summary.p95).padEnd(9)} ` +
      `max ${milliseconds(summary.max)}`,
  )
}

const overall = summarize(all)
const hitRatio = ((all.length - misses) / all.length) * 100

console.log('')
console.log(`overall: ${String(all.length)} requests, ${hitRatio.toFixed(1)}% hit`)
console.log(`overall: p50 ${milliseconds(overall.p50)}  p95 ${milliseconds(overall.p95)}  max ${milliseconds(overall.max)}`)
console.log('')
console.log('This is a local runtime, so the figures contain no network. A deployed')
console.log('P95 is a measurement against a deployment, not against this.')
