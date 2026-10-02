import { getProductResponseSchema } from '@typeky/api'
import { createLiquidRuntime } from '@typeky/theme-kit'
import { describe, expect, it } from 'vitest'

/**
 * What a product template will be able to consume.
 *
 * M4-S3's acceptance is that the product data can be consumed by an M6 template,
 * and M6 does not exist yet. What can be settled now is the part that would be
 * expensive to discover later: that a product's fields are all **plain JSON** and
 * in shapes Liquid can iterate and print. A price stored as three fields, a
 * gallery stored as one opaque string, or a `Date` that JSON turns into
 * something else would each be a rewrite of both the API and every template.
 *
 * The pairing is this: the endpoint tests assert the API answers with exactly
 * this shape, and this test asserts that shape renders. What is *not* covered
 * here is the context assembly itself -- resolving media ids to URLs, and the
 * snake_case naming the architecture shows for context keys (`logo_url`,
 * `blocks_html`) -- because that is M6's, and inventing it now would be a guess
 * dressed as a test.
 */

/** The product as the API answers with it, checked against the contract below. */
const PRODUCT = getProductResponseSchema().parse({
  id: 'product_1',
  title: 'Desk lamp',
  slug: 'desk-lamp',
  summary: 'A lamp for a small desk',
  blocks: [],
  coverMediaId: 'media_cover',
  gallery: ['media_one', 'media_two'],
  specs: [
    { label: 'Height', value: '40 cm' },
    { label: 'Bulb', value: 'E27' },
  ],
  priceLabel: 'From $20',
  ctaLabel: 'Buy now',
  ctaUrl: 'https://example.com/checkout',
  seo: {},
  status: 'published',
  sortOrder: 0,
  revision: 1,
  publishedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const TEMPLATE = [
  '<h1>{{ product.title }}</h1>',
  '<p class="summary">{{ product.summary }}</p>',
  '<p class="price">{{ product.priceLabel }}</p>',
  '<ul class="gallery">',
  '{% for image in product.gallery %}<li>{{ image }}</li>{% endfor %}',
  '</ul>',
  '<dl class="specs">',
  '{% for spec in product.specs %}<dt>{{ spec.label }}</dt><dd>{{ spec.value }}</dd>{% endfor %}',
  '</dl>',
  '{% if product.ctaUrl %}<a href="{{ product.ctaUrl }}">{{ product.ctaLabel }}</a>{% endif %}',
].join('\n')

describe('a product as a render context', () => {
  it('carries nothing a template cannot print', () => {
    // The architecture requires the context to be plain JSON: no Dates, no
    // undefined, nothing a template would silently render as blank.
    expect(JSON.parse(JSON.stringify(PRODUCT))).toEqual(PRODUCT)
  })

  it('renders every field a product card needs', async () => {
    const { render } = createLiquidRuntime()

    const html = await render(TEMPLATE, { product: PRODUCT })

    expect(html).toContain('<h1>Desk lamp</h1>')
    expect(html).toContain('A lamp for a small desk')
    expect(html).toContain('From $20')
    expect(html).toContain('<li>media_one</li>')
    expect(html).toContain('<li>media_two</li>')
    expect(html).toContain('<dt>Height</dt><dd>40 cm</dd>')
    expect(html).toContain('<dt>Bulb</dt><dd>E27</dd>')
    expect(html).toContain('<a href="https://example.com/checkout">Buy now</a>')
  })

  it('escapes what a template prints, so a title cannot inject markup', async () => {
    const { render } = createLiquidRuntime()

    const html = await render('<h1>{{ product.title }}</h1>', {
      product: { ...PRODUCT, title: 'Lamp <script>alert(1)</script>' },
    })

    expect(html).toBe('<h1>Lamp &lt;script&gt;alert(1)&lt;/script&gt;</h1>')
  })

  it('renders an empty gallery and spec list without leaving stray items behind', async () => {
    const { render } = createLiquidRuntime()

    const html = await render(TEMPLATE, { product: { ...PRODUCT, gallery: [], specs: [] } })

    // The shape a brand-new product has. Whitespace between the list tags is the
    // template's business; what matters is that looping over nothing produces no
    // rows rather than a placeholder or a broken tag.
    expect(html).not.toContain('<li>')
    expect(html).not.toContain('<dt>')
    expect(html).toContain('From $20')
    expect(html).toContain('Buy now')
  })
})
