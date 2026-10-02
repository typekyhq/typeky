import { describe, expect, it } from 'vitest'
import { contextPaths } from './sample'

/**
 * The paths a template may read.
 *
 * This is what the admin shows an author as "available template tags", so the two
 * things worth pinning are that it is complete enough to be useful and that it
 * never names something a template cannot read. It is derived from the sample the
 * previews render with, which is why it cannot say anything the platform does not
 * build -- these tests are about the derivation, not about a list.
 */
describe('the paths a template may read', () => {
  it('has the page fields a page actually has', () => {
    const paths = contextPaths('templates/page')

    for (const path of [
      'site.name',
      'site.logo_url',
      'site.nav',
      'site.settings.footer',
      'page.kind',
      'page.url',
      'content.title',
      'content.slug',
      'content.url',
      'content.blocks',
      'seo.title',
    ]) {
      expect(paths).toContain(path)
    }
  })

  it('does not claim a page has a post’s fields', () => {
    const paths = contextPaths('templates/page')

    // A page is not a post, and the reference in its editor is the page's own
    // context. Listing these would be telling an author to read something that
    // renders nothing.
    expect(paths).not.toContain('content.terms')
    expect(paths).not.toContain('content.tags')
    expect(paths).not.toContain('content.price_label')
  })

  it('has the fields only a post or a product has, on those samples', () => {
    expect(contextPaths('templates/post')).toContain('content.terms')
    expect(contextPaths('templates/post')).toContain('content.tags')
    expect(contextPaths('templates/product')).toContain('content.price_label')
  })

  it('describes media fields even though a preview resolves none', () => {
    // A preview has no bucket, so it renders no logo -- but `site.logo_url` is a
    // field of the context, and leaving it out of the reference because of the
    // preview's circumstances would be telling an author less than the truth.
    expect(contextPaths('templates/page')).toContain('site.logo_url')
    expect(contextPaths('templates/post')).toContain('content.cover_url')
  })

  it('stops at an array rather than walking into it', () => {
    const paths = contextPaths('templates/page')

    expect(paths).toContain('site.nav')
    // `site.nav` is a list a template iterates, and its items are not addressed by
    // name from the context.
    expect(paths.some((path) => path.startsWith('site.nav.'))).toBe(false)
  })

  it('stops at Block JSON, which is data rather than a shape to read', () => {
    const paths = contextPaths('templates/page')

    expect(paths).toContain('content.blocks')
    expect(paths.some((path) => path.startsWith('content.blocks.'))).toBe(false)
  })

  it('is sorted, so two runs and two screens agree', () => {
    const paths = contextPaths('templates/page')

    expect(paths).toEqual([...paths].sort())
  })
})
