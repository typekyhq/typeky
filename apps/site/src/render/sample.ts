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
  // A real media id, so `site.logo_url` is a field of the context -- see
  // `contextPaths`. A preview still renders no logo, because the preview's media
  // resolver has no bucket to resolve against.
  logoMediaId: 'sample-logo',
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
/**
 * How deep the walk goes.
 *
 * `site.settings.footer` is three, and `content.blocks` is where it should stop:
 * Block JSON is data a template hands to `render_blocks`, not a shape it reads
 * field by field.
 */
const MAX_DEPTH = 3

/**
 * The paths a template may read, taken from a real context.
 *
 * Derived rather than written down, and that is the point: a hand-kept list of
 * what a template can use stops being true the first time the context gains a
 * field, and the way it goes wrong is by telling an author about something that
 * renders nothing. This walks the same sample the preview renders with, so it
 * cannot claim anything the platform does not build.
 *
 * Arrays and objects at `MAX_DEPTH` are reported as the path itself: `site.nav` is
 * something a template iterates, and what is inside `content.blocks` is not part of
 * the contract.
 */
export function contextPaths(templateName: string): string[] {
  const paths: string[] = []

  const walk = (value: unknown, prefix: string, depth: number): void => {
    if (prefix === '') {
      // The top of the context is an object by construction; the cast is what
      // keeps this from being an `any` that spreads.
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        walk(child, key, depth + 1)
      }
      return
    }

    if (value === null || value === undefined || Array.isArray(value) || typeof value !== 'object') {
      paths.push(prefix)
      return
    }

    if (depth >= MAX_DEPTH) {
      paths.push(prefix)
      return
    }

    for (const [key, child] of Object.entries(value)) {
      walk(child, `${prefix}.${key}`, depth + 1)
    }
  }

  // A placeholder URL rather than nothing: `logo_url`, `cover_url` and the gallery
  // are real fields a template may read, and a reference that left them out because
  // the sample happens to have no bucket would be telling an author less than the
  // truth.
  walk(sampleContext(templateName, () => 'https://example.com/media/sample'), '', 0)
  return paths.sort()
}

export function sampleContext(
  templateName: string,
  /**
   * How a media id becomes a URL. The preview passes nothing and gets no media --
   * there is no bucket to resolve against. `contextPaths` passes one, so the fields
   * that only exist when there *is* media are in the list.
   */
  resolveMedia: (id: string) => string | null = () => null,
): ReturnType<typeof buildRenderContext> {
  const file = templateName.split('/').at(-1) ?? 'page'

  const base = {
    site: SAMPLE_SITE,
    resolveMedia,
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
        coverMediaId: 'sample-cover',
        priceLabel: 'From $20',
        gallery: ['sample-gallery-1', 'sample-gallery-2'],
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
        // Declared, so `content.cover_url` is a field of the context -- see the note
        // on the sample site's logo. The preview still renders no image.
        coverMediaId: 'sample-cover',
        excerpt: 'A short summary, as it would appear in a list.',
        terms: [{ name: 'News', slug: 'news', vocabulary: 'Categories' }],
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
