import { describe, expect, it } from 'vitest'
import {
  createLiquidRuntime,
  DEFAULT_RENDER_LIMITS,
  LIQUID_FILTERS,
  LIQUID_TAGS,
  TemplateOutputLimitError,
} from './runtime'

describe('liquid runtime', () => {
  describe('escaping', () => {
    it('escapes output by default', async () => {
      const { render } = createLiquidRuntime()

      expect(await render('{{ value }}', { value: '<b>hi</b>' })).toBe('&lt;b&gt;hi&lt;/b&gt;')
    })

    it('escapes quotes, which is what a user-controlled attribute needs', async () => {
      const { render } = createLiquidRuntime()

      expect(await render('{{ value }}', { value: '" onmouseover="x' })).toBe(
        '&#34; onmouseover=&#34;x',
      )
    })

    it('lets an explicitly safe value through the raw filter', async () => {
      const { render } = createLiquidRuntime()

      expect(await render('{{ value | raw }}', { value: '<b>hi</b>' })).toBe('<b>hi</b>')
    })

    it('leaves non-strings alone and renders null as empty', async () => {
      const { render } = createLiquidRuntime()

      expect(await render('{{ n }}|{{ b }}|[{{ nothing }}]', { n: 42, b: true, nothing: null })).toBe(
        '42|true|[]',
      )
    })
  })

  describe('sandbox', () => {
    it('refuses a tag outside the whitelist', async () => {
      const { render } = createLiquidRuntime()

      await expect(render('{% echo "x" %}')).rejects.toThrow(/echo/)
      await expect(render('{% block %}x{% endblock %}')).rejects.toThrow(/block/)
    })

    it('refuses a filter outside the whitelist instead of silently doing nothing', async () => {
      const { render } = createLiquidRuntime()

      await expect(render('{{ x | base64_encode }}', { x: 'a' })).rejects.toThrow(/base64_encode/)
      await expect(render('{{ x | sha256 }}', { x: 'a' })).rejects.toThrow(/sha256/)
    })

    it('cannot walk the prototype chain', async () => {
      const { render } = createLiquidRuntime()

      expect(await render('[{{ x.constructor }}][{{ x.__proto__ }}]', { x: {} })).toBe('[][]')
    })

    it('renders a missing variable as empty rather than failing the page', async () => {
      const { render } = createLiquidRuntime()

      expect(await render('[{{ missing.deeper }}]')).toBe('[]')
    })

    it('keeps every whitelisted tag usable', () => {
      const { engine } = createLiquidRuntime()

      for (const tag of LIQUID_TAGS) {
        expect(engine.tags, `tag ${tag} is missing`).toHaveProperty(tag)
      }
    })

    it('keeps every whitelisted filter usable', () => {
      const { engine } = createLiquidRuntime()

      for (const filter of LIQUID_FILTERS) {
        expect(engine.filters, `filter ${filter} is missing`).toHaveProperty(filter)
      }
    })

    it('drops the liquidjs tags the theme contract does not use', () => {
      const { engine } = createLiquidRuntime()

      for (const tag of ['block', 'echo', 'tablerow', 'paginate']) {
        expect(engine.tags).not.toHaveProperty(tag)
      }
    })

    it('drops the liquidjs filters the theme contract does not use', () => {
      const { engine } = createLiquidRuntime()

      for (const filter of [
        'base64_encode',
        'sha256',
        'inspect',
        'where_exp',
        'xml_escape',
        'sort_natural',
        'date_to_string',
      ]) {
        expect(engine.filters).not.toHaveProperty(filter)
      }
    })

    it('does not leak the whitelist into another runtime', () => {
      const first = createLiquidRuntime()
      delete (first.engine.filters as Record<string, unknown>).escape

      const second = createLiquidRuntime()
      expect(second.engine.filters).toHaveProperty('escape')
    })
  })

  describe('limits', () => {
    it('rejects a template over parseLimit', async () => {
      const { render } = createLiquidRuntime({ limits: { parseLimit: 60 } })

      await expect(render(`{% if true %}${'a'.repeat(200)}{% endif %}`)).rejects.toThrow(
        /parse length limit/,
      )
    })

    it('aborts a render that runs past renderLimit', async () => {
      // memoryLimit is raised so the runaway loop trips the time budget rather
      // than the allocation budget first; with production limits the memory
      // limit is normally what stops this shape of template.
      const { render } = createLiquidRuntime({
        limits: { renderLimit: 80, memoryLimit: 1_000_000_000 },
      })

      await expect(render('{% for i in (1..100000000) %}{{ i }}{% endfor %}')).rejects.toThrow(
        /render limit/,
      )
    })

    it('aborts the same runaway loop under the production limits, whichever trips first', async () => {
      const { render } = createLiquidRuntime()

      await expect(render('{% for i in (1..100000000) %}{{ i }}{% endfor %}')).rejects.toThrow(
        /(render limit|memory alloc limit)/,
      )
    })

    it('aborts a render that allocates past memoryLimit', async () => {
      const { render } = createLiquidRuntime({ limits: { memoryLimit: 2000 } })

      await expect(
        render(
          '{% assign s = "aaaaaaaa" %}{% for i in (1..5000) %}{% assign s = s | append: s %}{% endfor %}',
        ),
      ).rejects.toThrow(/memory alloc limit/)
    })

    it('aborts when the rendered output exceeds the byte cap', async () => {
      const runtime = createLiquidRuntime({ limits: { maxOutputBytes: 1024 } })

      await expect(runtime.render('{% for i in (1..5000) %}xxxxxxxxxx{% endfor %}')).rejects.toThrow(
        TemplateOutputLimitError,
      )
    })

    it('measures the cap in bytes, so a CJK page hits it sooner', async () => {
      const runtime = createLiquidRuntime({ limits: { maxOutputBytes: 1000 } })

      // 400 CJK characters are 1200 bytes, over the cap; 100 characters are 300.
      await expect(runtime.render('{% for i in (1..400) %}中{% endfor %}')).rejects.toThrow(
        TemplateOutputLimitError,
      )
      await expect(runtime.render('{% for i in (1..100) %}中{% endfor %}')).resolves.toHaveLength(100)
    })

    it('reports the measured size and the limit on failure', async () => {
      const runtime = createLiquidRuntime({ limits: { maxOutputBytes: 10 } })

      const error = await runtime.render('{% for i in (1..20) %}x{% endfor %}').catch((thrown) => thrown)
      expect(error).toBeInstanceOf(TemplateOutputLimitError)
      expect((error as TemplateOutputLimitError).bytes).toBe(20)
      expect((error as TemplateOutputLimitError).limit).toBe(10)
    })

    it('ships the documented defaults', () => {
      expect(DEFAULT_RENDER_LIMITS).toEqual({
        parseLimit: 2_000_000,
        renderLimit: 500,
        memoryLimit: 8_000_000,
        maxOutputBytes: 5_000_000,
      })
      expect(createLiquidRuntime().limits).toEqual(DEFAULT_RENDER_LIMITS)
    })
  })
})
