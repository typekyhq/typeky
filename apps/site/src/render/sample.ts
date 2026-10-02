import type { Block } from '@typeky/core'
import { buildRenderContext, type SiteInput } from './context'

/**
 * The data a preview is rendered with.
 *
 * Every field is filled, and filled with something a template would actually
 * meet: a list with items, a product with a gallery and specs, a post with tags.
 * A fixture of empty strings would render a page that tells a theme author
 * nothing about whether their layout works.
 *
 * It is deliberately *not* the site's own content. A preview answers "what does
 * this template look like", and using real rows would make the answer depend on
 * which post happened to be newest -- so a theme could look right by accident.
 * The sample is fixed, which is also what makes two previews comparable.
 */

const SAMPLE_SITE: SiteInput = {
  name: 'Sample Site',
  tagline: 'A site for previewing templates',
  logoMediaId: null,
  settings: {
    language: 'en',
    footer: 'Built with Typeky.',
    socialLinks: [{ label: 'GitHub', href: 'https://example.com/github' }],
    cookieNotice: 'This site uses no cookies.',
  },
  nav: [
    { label: 'Home', href: '/', order: 0 },
    { label: 'Posts', href: '/posts', order: 1 },
    { label: 'Products', href: '/products', order: 2 },
  ],
}

const SAMPLE_BLOCKS: Block[] = [
  { type: 'paragraph', content: [{ type: 'text', text: 'This is a sample paragraph. ' }, { type: 'text', text: 'And this part is bold.', marks: [{ type: 'bold' }] }] },
  { type: 'heading', level: 2, content: [{ type: 'text', text: 'A sample heading' }] },
  {
    type: 'list',
    ordered: false,
    items: [
      { content: [{ type: 'text', text: 'A first item' }], children: [] },
      { content: [{ type: 'text', text: 'A second item' }], children: [] },
    ],
  },
  {
    type: 'quote',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A quotation, for spacing.' }] }],
  },
  { type: 'divider' },
  {
    type: 'cta',
    title: 'Try it',
    body: 'A call to action renders here.',
    label: 'Get started',
    href: 'https://example.com/start',
  },
]

/**
 * One sample per kind of page, so previewing `templates/posts` shows a list and
 * previewing `templates/post` shows one item -- which is the difference a theme
 * author is usually trying to see.
 */
export function sampleContext(templateName: string): ReturnType<typeof buildRenderContext> {
  const file = templateName.split('/').at(-1) ?? 'page'

  const base = {
    site: SAMPLE_SITE,
    resolveMedia: () => null,
    preview: true,
  } as const

  if (file === 'posts' || file === 'products') {
    const listItems = [1, 2, 3].map((index) => ({
      title: file === 'posts' ? `Sample post ${String(index)}` : `Sample product ${String(index)}`,
      slug: `sample-${String(index)}`,
      url: file === 'posts' ? `/posts/sample-${String(index)}` : `/products/sample-${String(index)}`,
      excerpt: 'A short summary, as it would appear in a list.',
      ...(file === 'products' ? { price_label: 'From $20' } : {}),
    }))

    return buildRenderContext({
      ...base,
      item: {
        kind: file === 'posts' ? 'posts' : 'products',
        title: file === 'posts' ? 'Posts' : 'Products',
        slug: file === 'posts' ? 'posts' : 'products',
        blocks: [],
        seo: {},
        listItems,
      },
    })
  }

  if (file === 'product') {
    return buildRenderContext({
      ...base,
      item: {
        kind: 'product',
        title: 'Sample product',
        slug: 'sample-product',
        blocks: SAMPLE_BLOCKS,
        seo: {},
        priceLabel: 'From $20',
        gallery: [],
        specs: [
          { label: 'Material', value: 'Recycled aluminium' },
          { label: 'Warranty', value: '2 years' },
        ],
        ctaLabel: 'Talk to us',
        ctaUrl: 'https://example.com/contact',
      },
    })
  }

  if (file === '404') {
    return buildRenderContext({
      ...base,
      item: { kind: 'notFound', title: 'Not found', slug: '404', blocks: [], seo: {} },
    })
  }

  if (file === 'post') {
    return buildRenderContext({
      ...base,
      item: {
        kind: 'post',
        title: 'Sample post 1',
        slug: 'sample-1',
        blocks: SAMPLE_BLOCKS,
        seo: {},
        excerpt: 'A short summary, as it would appear in a list.',
        category: 'News',
        tags: ['sample', 'theme'],
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    })
  }

  return buildRenderContext({
    ...base,
    item: {
      kind: file === 'home' ? 'home' : 'page',
      title: file === 'home' ? 'Sample Site' : 'Sample page',
      slug: file === 'home' ? '' : 'sample-page',
      blocks: SAMPLE_BLOCKS,
      seo: {},
    },
  })
}
