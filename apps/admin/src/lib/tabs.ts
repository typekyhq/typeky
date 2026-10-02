/**
 * The panels a long form is split into, and which of them a field belongs to.
 *
 * Every form in the panel is one document with one save button, and the tabs are
 * only a way of laying it out. That makes them dangerous: a save that fails on a
 * field in a panel nobody is looking at gives the operator "some fields need
 * attention" and no way to find them.
 *
 * `owns` is how each panel says which fields are its own -- by prefix, because a
 * validation path is dotted (`settings.seo.defaultTitle`, `specs.0.label`). One
 * implementation of the match, shared by every form, so a new one cannot get the
 * rule slightly different.
 */
export interface FormTab {
  id: string
  /** A locale key: this module holds no English. */
  labelKey: string
  /** The validation paths this panel owns, by prefix. */
  owns: string[]
}

/**
 * The panel a failed field lives in.
 *
 * Falls back to the first tab, which is the one a form opens on: a field that
 * belongs to no panel is a mistake in the `owns` lists, and opening the form
 * again is a better answer than opening nothing.
 */
export function tabOwning(tabs: readonly FormTab[], key: string): string {
  const owner = tabs.find((tab) => tab.owns.some((prefix) => key === prefix || key.startsWith(`${prefix}.`)))

  return owner?.id ?? tabs[0]?.id ?? ''
}
