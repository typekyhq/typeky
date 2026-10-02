import { describe, expect, it } from 'vitest'
import { getPageWriteSchema } from './pages'

const VALID = { title: 'About', slug: 'about' }

describe('the page write contract', () => {
  it('accepts a title and a slug', () => {
    expect(getPageWriteSchema().safeParse(VALID).success).toBe(true)
  })

  it('refuses a slug that would need escaping in a URL', () => {
    for (const slug of ['About', 'two words', 'trailing-', '-leading', 'a/b', '']) {
      expect(getPageWriteSchema().safeParse({ ...VALID, slug }).success, slug).toBe(false)
    }
  })

  it('cannot carry the home flag', () => {
    // `is_home` is changed through its own action. A whole-document write that
    // could set it would make two saves arriving together decide the outcome by
    // order, and the database allows exactly one home page.
    const parsed = getPageWriteSchema().safeParse({ ...VALID, isHome: true })

    expect(parsed.success).toBe(true)
    expect(parsed.success && 'isHome' in parsed.data).toBe(false)
  })

  it('refuses a sort order it could not store', () => {
    expect(getPageWriteSchema().safeParse({ ...VALID, sortOrder: -1 }).success).toBe(false)
    expect(getPageWriteSchema().safeParse({ ...VALID, sortOrder: 1.5 }).success).toBe(false)
    expect(getPageWriteSchema().safeParse({ ...VALID, sortOrder: 0 }).success).toBe(true)
  })

  it('accepts a block body and refuses one it cannot store', () => {
    const blocks = [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }]

    expect(getPageWriteSchema().safeParse({ ...VALID, blocks }).success).toBe(true)
    expect(getPageWriteSchema().safeParse({ ...VALID, blocks: [{ type: 'table' }] }).success).toBe(false)
  })
})
