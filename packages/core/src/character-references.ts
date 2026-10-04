/**
 * The other direction from `escapeHtml`: what an operator typed, read back.
 *
 * A site's settings are text an operator writes into a plain field, and operators
 * write HTML-flavoured text there -- `Copyright &copy; 2026`, `A &mdash; B`,
 * `&nbsp;`. Every character a template prints is escaped (that is the theme
 * contract, and it is what stops a content title from injecting markup), so an
 * entity typed into a setting came out on the page as the entity itself: the
 * footer read `Copyright &copy; 2026 typeky.com` to every visitor.
 *
 * The fix is here rather than in the theme, and it is *decoding* rather than a
 * second raw output path:
 *
 *   - decoding turns `&copy;` into `©`, which the escaping then leaves alone. The
 *     output is still escaped, so nothing an operator types can become markup.
 *   - a raw path would have made the field an HTML sink, and the platform already
 *     has the right shape for markup an operator writes: a block body, rendered
 *     by `blockToHtml`, and structured fields (nav, social links) for links.
 *
 * A reference that is not recognised is left exactly as it was typed, semicolon
 * and all, so `A & B` and `AT&T` survive untouched. The semicolon is required:
 * browsers accept `&copy` without one through a legacy table, and reproducing that
 * table is how `&ampersand` turns into `&ersand`.
 */

/**
 * The references worth knowing, which is not the whole HTML5 table.
 *
 * Two thousand entries exist for glyphs nobody types into a footer. These are the
 * ones that show up in real copy: the five characters that have to be written as
 * references when you *are* writing HTML, and the punctuation, currency and
 * spacing marks that a word processor produces.
 */
const NAMED_REFERENCES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '©',
  reg: '®',
  trade: '™',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  middot: '·',
  bull: '•',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  sbquo: '‚',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  dagger: '†',
  Dagger: '‡',
  permil: '‰',
  prime: '′',
  Prime: '″',
  times: '×',
  divide: '÷',
  plusmn: '±',
  minus: '−',
  micro: 'µ',
  deg: '°',
  para: '¶',
  sect: '§',
  cent: '¢',
  pound: '£',
  yen: '¥',
  euro: '€',
  curren: '¤',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  larr: '←',
  rarr: '→',
  harr: '↔',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  shy: '\u00ad',
}

/** `&name;`, `&#169;` and `&#xA9;` — the semicolon is not optional. */
const REFERENCE = /&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|([a-zA-Z][a-zA-Z0-9]*));/g

/**
 * Resolves the character references in a string, once.
 *
 * Not idempotent and not meant to be: `&amp;copy;` is the way to write a literal
 * `&copy;`, so running this twice would eat the escape. It belongs at the boundary
 * where stored text becomes a render context, and nowhere else.
 */
export function decodeCharacterReferences(value: string): string {
  return value.replace(REFERENCE, (whole, hex: string, decimal: string, name: string) => {
    if (name !== undefined && name !== '') {
      // Case matters for the handful of names that share a word -- `&dagger;` and
      // `&Dagger;` are different marks -- so the table is read as written.
      return NAMED_REFERENCES[name] ?? whole
    }

    const codePoint = hex === undefined ? Number(decimal) : parseInt(hex, 16)

    // A code point outside Unicode, or a lone surrogate, is not a character. Left
    // as typed rather than replaced, because the operator can see and fix that.
    if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return whole
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return whole

    return String.fromCodePoint(codePoint)
  })
}
