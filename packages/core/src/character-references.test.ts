import { describe, expect, it } from 'vitest'
import { decodeCharacterReferences } from './character-references'
import { escapeHtml } from './html'

/**
 * Reading back what an operator typed.
 *
 * A settings field is plain text, and the page escapes everything a template
 * prints -- so an entity typed into the footer reached a visitor as the entity
 * itself. This is the other half of escaping, and the two are only right together.
 */

describe('decoding character references', () => {
  it('turns a named reference into its character', () => {
    const footer = 'Copyright &copy; 2026 typeky.com'

    expect(decodeCharacterReferences(footer)).toBe('Copyright © 2026 typeky.com')
    expect(decodeCharacterReferences('A &mdash; B')).toBe('A — B')
    expect(decodeCharacterReferences('x&nbsp;y')).toBe('x\u00a0y')
  })

  it('turns a numeric reference into its character', () => {
    expect(decodeCharacterReferences('&#169;')).toBe('©')
    expect(decodeCharacterReferences('&#xA9;')).toBe('©')
    expect(decodeCharacterReferences('&#x1F600;')).toBe('😀')
  })

  it('leaves anything it does not recognise exactly as it was typed', () => {
    // A lone ampersand is not a reference, and `AT&T` is not `AT` plus a trademark.
    expect(decodeCharacterReferences('A & B')).toBe('A & B')
    expect(decodeCharacterReferences('AT&T')).toBe('AT&T')
    expect(decodeCharacterReferences('&notarealentity;')).toBe('&notarealentity;')
  })

  it('requires the semicolon', () => {
    // Browsers decode `&copy` without one through a legacy table. Copying that
    // table is how `&ampersand` quietly becomes `&ersand`.
    expect(decodeCharacterReferences('&copy')).toBe('&copy')
    expect(decodeCharacterReferences('&ampersand')).toBe('&ampersand')
  })

  it('is case-sensitive where the marks differ', () => {
    expect(decodeCharacterReferences('&dagger;')).toBe('†')
    expect(decodeCharacterReferences('&Dagger;')).toBe('‡')
  })

  it('resolves each reference once, so an escaped one stays escaped', () => {
    // `&amp;copy;` is how you write a literal `&copy;`. Running this twice would eat
    // the escape, which is why it belongs at one boundary and nowhere else.
    expect(decodeCharacterReferences('&amp;copy;')).toBe('&copy;')
  })

  it('refuses a code point that is not a character', () => {
    expect(decodeCharacterReferences('&#x110000;')).toBe('&#x110000;')
    expect(decodeCharacterReferences('&#xD800;')).toBe('&#xD800;')
    expect(decodeCharacterReferences('&#0;')).toBe('&#0;')
  })

  it('is the half that makes an escaped setting come back as the character', () => {
    // Both halves in one line, which is the whole point: the page shows ©, not the
    // entity the operator typed to get it.
    expect(escapeHtml(decodeCharacterReferences('Copyright &copy; 2026'))).toBe(
      'Copyright © 2026',
    )
  })
})
