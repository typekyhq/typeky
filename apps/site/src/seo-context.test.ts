import { getPostResponseSchema } from '@typeky/api'
import { createLiquidRuntime } from '@typeky/theme-kit'
import { describe, expect, it } from 'vitest'

/**
 * SEO overrides as a render context.
 *
 * M4-S5's acceptance is that the values are written to `seo_metadata` and take
 * effect when M6 renders. The writing is the endpoint tests' business, and this
 * is the other half: that the shape those values are stored in is something a
 * template can print, and that the distinction the contract draws survives all
 * the way through.
 *
 * That distinction is the whole point of the field being optional. An absent
 * description means "derive one from the excerpt"; an empty one means the author
 * cleared it. A renderer that could not tell those apart would either invent
 * descriptions somebody deleted or print nothing where a default belonged.
 *
 * What is not here is the resolution itself -- turning `ogImageMediaId` into a
 * URL, and choosing between the override and the fallback. That is M6's, and
 * writing a version of it here would be a guess wearing a test's clothes.
 */

const SEO = {
  title: 'Desk lamp — a small light for small desks',
  description: 'Recycled aluminium, an E27 bulb and a two year warranty.',
  ogImageMediaId: 'media_one',
  canonical: 'https://example.com/desk-lamp',
}

function post(seo: unknown) {
  return getPostResponseSchema().parse({
    id: 'post_1',
    title: 'Desk lamp',
    slug: 'desk-lamp',
    excerpt: 'A lamp for a small desk',
    coverMediaId: null,
    blocks: [],
    tags: [],
    terms: [],
    seo,
    status: 'published',
    revision: 1,
    publishedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
}

describe('SEO overrides as a render context', () => {
  it('carries nothing a template cannot print', () => {
    const value = post(SEO)

    expect(JSON.parse(JSON.stringify(value.seo))).toEqual(value.seo)
  })

  it('renders the tags a page needs', async () => {
    const { render } = createLiquidRuntime()
    const value = post(SEO)

    const html = await render(
      [
        '{% if seo.title %}<title>{{ seo.title }}</title>{% endif %}',
        '{% if seo.description %}<meta name="description" content="{{ seo.description }}">{% endif %}',
        '{% if seo.canonical %}<link rel="canonical" href="{{ seo.canonical }}">{% endif %}',
        '{% if seo.ogImageMediaId %}<meta property="og:image" content="{{ seo.ogImageMediaId }}">{% endif %}',
      ].join('\n'),
      { seo: value.seo },
    )

    expect(html).toContain(`<title>${SEO.title}</title>`)
    expect(html).toContain(`content="${SEO.description}"`)
    expect(html).toContain(`href="${SEO.canonical}"`)
    expect(html).toContain(`content="${SEO.ogImageMediaId}"`)
  })

  it('lets a template tell "not set" from "cleared"', async () => {
    const { render } = createLiquidRuntime()
    const template = '{% if seo.description == nil %}derived{% else %}set to:{{ seo.description }}{% endif %}'

    // Absent: derive one.
    expect(await render(template, { seo: post({}).seo })).toBe('derived')

    // Cleared: an empty string, which is not the same thing.
    expect(await render(template, { seo: post({ description: '' }).seo })).toBe('set to:')
  })

  it('keeps every override that was set, and no others', () => {
    const value = post(SEO)

    expect(Object.keys(value.seo).sort()).toEqual(
      ['canonical', 'description', 'ogImageMediaId', 'title'].sort(),
    )
    expect(post({}).seo).toEqual({})
  })
})
