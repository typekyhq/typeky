/**
 * A slug out of a title, for a new item.
 *
 * Latin-friendly by design: a title in a script this cannot transliterate
 * produces an empty string and the author supplies their own, which is better
 * than a slug made of dashes.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
