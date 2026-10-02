import type { DbPort } from '@typeky/platform'
import { describe, expect, it } from 'vitest'
import { createTemplateLoader } from './loader'
import { createLiquidRuntime } from './runtime'

/**
 * Sandbox regression suite.
 *
 * A theme is untrusted input (ADR-13): it is written by the operator, bought
 * from a marketplace, or ported from a Shopify theme whose author has never
 * heard of this platform. Everything here is written as an attempt rather than
 * as a description, because "the loader validates names" is a claim and
 * `{% render '../../secrets' %}` is a test.
 *
 * Run it alone with `pnpm test:sandbox`. It is also part of `pnpm test`, so CI
 * has always run it; the script exists so a change to the sandbox can be checked
 * without waiting for everything else.
 *
 * Five ways in, which is the list the milestone names: a name the theme does not
 * ship, a name that tries to climb out of the theme, a template too large to
 * parse, output too large to return, and a tag or filter that was deliberately
 * left out.
 */

const BASELINE = {
  'layouts/base': '{% block %}{% endblock %}',
  'templates/post': '<h1>{{ content.title }}</h1>',
  'snippets/footer': 'built with typeky',
}

const NO_DB: DbPort = {
  async all<T>() {
    return [] as T[]
  },
  async first<T>() {
    return null as T | null
  },
  async run() {
    return 0
  },
  async batch() {
    return undefined
  },
}

/**
 * The production wiring, with limits small enough to trip on purpose.
 *
 * Low limits and the real defaults everywhere else, so what this exercises is
 * the shipped path rather than a configuration nobody runs.
 */
function sandbox(limits: Partial<{ parseLimit: number; renderLimit: number; maxOutputBytes: number }> = {}) {
  const loader = createTemplateLoader({ db: NO_DB, theme: 'default', baseline: BASELINE })
  const runtime = createLiquidRuntime({
    fs: loader.fs,
    cache: false,
    limits: { parseLimit: 5_000, renderLimit: 200, maxOutputBytes: 1_000, ...limits },
    renderBlocks: () => '<p>blocks</p>',
  })

  return { loader, runtime }
}

describe('names the theme does not ship', () => {
  it('refuses a template that does not exist, by name', async () => {
    const { runtime } = sandbox()

    await expect(runtime.renderFile('templates/mine', {})).rejects.toThrow()
  })

  it('refuses one the caller invented at render time', async () => {
    const { runtime } = sandbox()

    await expect(runtime.render("{% render 'snippets/nope' %}", {})).rejects.toThrow()
    await expect(runtime.render("{% layout 'layouts/nope' %}", {})).rejects.toThrow()
  })

  it('accepts the bundled ones, so the refusals above are not everything failing', async () => {
    const { runtime } = sandbox()

    expect(await runtime.renderFile('snippets/footer', {})).toBe('built with typeky')
  })
})

describe('names that try to climb out of the theme', () => {
  const ATTEMPTS = [
    '../../etc/passwd',
    '/etc/passwd',
    'snippets/../../etc/passwd',
    '..%2f..%2fetc%2fpasswd',
    '....//....//etc/passwd',
    'templates/post\u0000.png',
    'layouts/base/../../../secret',
  ]

  it('refuses each of them through the loader', async () => {
    const { loader } = sandbox()

    for (const name of ATTEMPTS) {
      await expect(loader.read(name), name).rejects.toThrow()
      await expect(loader.isOverridden(name), name).resolves.toBe(false)
    }
  })

  it('refuses each of them through a render, which is the path that matters', async () => {
    const { runtime } = sandbox()

    for (const name of ATTEMPTS) {
      await expect(runtime.render(`{% render '${name}' %}`, {}), name).rejects.toThrow()
    }
  })

  it('refuses them at the whitelist rather than after a database read', async () => {
    let asked = false
    const loader = createTemplateLoader({
      db: {
        ...NO_DB,
        async all<T>() {
          asked = true
          return [] as T[]
        },
      },
      theme: 'default',
      baseline: BASELINE,
    })

    // The baseline is the complete set of names, so a name outside it is refused
    // before anything is looked up -- there is nothing to look up.  is
    // what a render calls first, and it answers from memory.
    for (const name of ATTEMPTS) {
      await expect(loader.fs.contains?.('', name), name).resolves.toBe(false)
      await expect(loader.read(name), name).rejects.toThrow()
    }
    expect(asked).toBe(false)
  })

  it('refuses traversal in an override row, whatever the baseline says', async () => {
    // A row is written through the API, which checks names too -- but the loader
    // is the last line, so the check is repeated here rather than assumed.
    const loader = createTemplateLoader({
      db: {
        ...NO_DB,
        async all<T>() {
          return [{ path: '../../etc/passwd', source: 'x', revision: 1 }] as T[]
        },
      },
      theme: 'default',
      baseline: BASELINE,
    })

    await expect(loader.read('../../etc/passwd')).rejects.toThrow()
  })

  it('does not let a draft introduce a name the theme lacks', async () => {
    // The preview's mechanism, and the one place a caller supplies a name
    // directly.
    const loader = createTemplateLoader({
      db: NO_DB,
      theme: 'default',
      baseline: BASELINE,
      draft: { path: 'templates/mine', source: 'x' },
    })

    await expect(loader.read('templates/mine')).rejects.toThrow()
  })
})

describe('templates too large to parse', () => {
  it('refuses one over parseLimit', async () => {
    const { runtime } = sandbox({ parseLimit: 200 })

    await expect(runtime.render(`{% if true %}${'a'.repeat(500)}{% endif %}`, {})).rejects.toThrow(
      /parse length limit/,
    )
  })

  it('refuses an override set over the template cap', async () => {
    const loader = createTemplateLoader({
      db: {
        ...NO_DB,
        async all<T>() {
          return Array.from({ length: 5 }, (_, index) => ({
            path: `snippets/s${String(index)}`,
            source: 'x',
            revision: 1,
          })) as T[]
        },
      },
      theme: 'default',
      baseline: BASELINE,
      maxOverrides: 4,
    })

    await expect(loader.read('snippets/footer')).rejects.toThrow(/over the 4 limit/)
  })

  it('refuses an override set whose source totals over the byte cap', async () => {
    const loader = createTemplateLoader({
      db: {
        ...NO_DB,
        async all<T>() {
          return [{ path: 'snippets/footer', source: 'x'.repeat(200), revision: 1 }] as T[]
        },
      },
      theme: 'default',
      baseline: BASELINE,
      maxOverrideBytes: 100,
    })

    await expect(loader.read('snippets/footer')).rejects.toThrow(/over the 100 limit/)
  })
})

describe('output too large to return', () => {
  it('aborts a runaway loop', async () => {
    const { runtime } = sandbox()

    await expect(runtime.render('{% for i in (1..100000000) %}{{ i }}{% endfor %}', {})).rejects.toThrow(
      /(render limit|memory alloc limit)/,
    )
  })

  it('aborts output over the byte cap', async () => {
    const { runtime } = sandbox({ maxOutputBytes: 100 })

    await expect(runtime.render('{{ x }}', { x: 'a'.repeat(500) })).rejects.toThrow(/over the 100 byte/)
  })

  it('applies the same cap when rendering a template by name', async () => {
    // The site renders by name; a cap that only covered `render(source)` would
    // not cover the path that serves pages.
    const { runtime } = sandbox({ maxOutputBytes: 10 })

    await expect(runtime.renderFile('templates/post', { content: { title: 'x'.repeat(500) } })).rejects.toThrow(
      /over the 10 byte/,
    )
  })

  it('measures the cap in bytes rather than characters, so CJK is not a way around it', async () => {
    const { runtime } = sandbox({ maxOutputBytes: 25 })

    // Ten three-byte characters are thirty bytes, over a thirty-byte cap once the
    // markup is counted -- and well under it if anything counted characters.
    await expect(runtime.render('{{ x }}', { x: '中'.repeat(10) })).rejects.toThrow()
  })
})

describe('tags and filters that were left out', () => {
  const TAGS = ['echo', 'tablerow', 'paginate', 'inline_comment', 'ifchanged', 'section', 'schema']
  const FILTERS = ['base64_encode', 'sha256', 'inspect', 'where_exp', 'xml_escape', 'hmac_sha256']

  it('refuses each tag, at render time rather than by rendering nothing', async () => {
    const { runtime } = sandbox()

    for (const tag of TAGS) {
      await expect(runtime.render(`{% ${tag} %}x{% end${tag} %}`, {}), tag).rejects.toThrow()
    }
  })

  it('refuses each filter, rather than silently rendering nothing', async () => {
    const { runtime } = sandbox()

    for (const filter of FILTERS) {
      await expect(runtime.render(`{{ x | ${filter} }}`, { x: 'a' }), filter).rejects.toThrow()
    }
  })

  it('has no tag that writes, because a theme only reads', async () => {
    const { runtime } = sandbox()

    // A theme cannot change anything: there is no write, no assign to the
    // database, no `{% include %}` of a URL. Any of these being absent is the
    // point, so the test is that the set of tags is the documented one.
    for (const tag of ['assign_to_db', 'save', 'write', 'http', 'eval', 'script']) {
      await expect(runtime.render(`{% ${tag} %}`, {}), tag).rejects.toThrow()
    }
  })
})

describe('the host', () => {
  it('cannot be reached through the prototype chain', async () => {
    const { runtime } = sandbox()

    const probes = [
      '{{ x.constructor }}',
      '{{ x.__proto__ }}',
      '{{ x.constructor.constructor }}',
      '{{ x.toString }}',
      "{{ x['constructor'] }}",
    ]

    for (const probe of probes) {
      expect(await runtime.render(probe, { x: {} }), probe).toBe('')
    }
  })

  it('cannot reach a global by naming it', async () => {
    const { runtime } = sandbox()

    for (const name of ['globalThis', 'process', 'require', 'fetch', 'eval', 'Function']) {
      expect(await runtime.render(`[{{ ${name} }}]`, {}), name).toBe('[]')
    }
  })

  it('is not handed a function it would call', async () => {
    const { runtime } = sandbox()

    // The context is required to be plain JSON, but the check is that a caller
    // who broke that rule does not get a function invoked on its behalf.
    let called = false
    const value = () => {
      called = true
      return 'called'
    }

    const html = await runtime.render('[{{ x }}]', { x: value })
    expect(called).toBe(false)
    expect(html).toBe('[]')
  })

  it('escapes everything it prints, because a theme prints what people wrote', async () => {
    const { runtime } = sandbox()

    const hostile = '<script>alert(1)</script>'
    expect(await runtime.render('{{ x }}', { x: hostile })).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(await runtime.render('<a title="{{ x }}">', { x: '" onmouseover="alert(1)' })).not.toContain('onmouseover="alert')
  })
})
