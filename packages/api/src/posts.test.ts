import { describe, expect, it } from 'vitest'
import { getPostWriteSchema } from './posts'

const VALID = { title: 'Hello', slug: 'hello' }

describe('the post write contract', () => {
  it('accepts a title and a slug, and nothing else', () => {
    const parsed = getPostWriteSchema().safeParse(VALID)

    expect(parsed.success).toBe(true)
  })

  it('refuses a slug that would need escaping in a URL', () => {
    for (const slug of ['Hello', 'two words', 'trailing-', '-leading', 'a/b', 'café', '']) {
      expect(getPostWriteSchema().safeParse({ ...VALID, slug }).success, slug).toBe(false)
    }
  })

  it('accepts the slugs a title actually produces', () => {
    for (const slug of ['a', 'hello-world', '2026-01-01-notes', 'x1']) {
      expect(getPostWriteSchema().safeParse({ ...VALID, slug }).success, slug).toBe(true)
    }
  })

  it('refuses an empty title', () => {
    expect(getPostWriteSchema().safeParse({ ...VALID, title: '' }).success).toBe(false)
  })

  it('accepts a block body and refuses one it cannot store', () => {
    const blocks = [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }]
    expect(getPostWriteSchema().safeParse({ ...VALID, blocks }).success).toBe(true)

    // A node the renderer has no rule for would serialize to nothing, so the
    // contract refuses it at the edge rather than accepting it here.
    expect(getPostWriteSchema().safeParse({ ...VALID, blocks: [{ type: 'table' }] }).success).toBe(false)
  })

  it('leaves the status optional, so a new post is a draft by default', () => {
    const parsed = getPostWriteSchema().safeParse(VALID)

    expect(parsed.success && parsed.data.status).toBeUndefined()
  })

  it('refuses a status it cannot render', () => {
    expect(getPostWriteSchema().safeParse({ ...VALID, status: 'archived' }).success).toBe(false)
  })
})
