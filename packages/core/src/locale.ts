/**
 * The language a site and a panel fall back to.
 *
 * One constant rather than a literal in each place that needed one, because
 * "which language is this when nobody has chosen" is a single answer and three
 * copies of `'en'` are three chances to change two of them.
 */

/** BCP 47. */
export const DEFAULT_LANGUAGE = 'en'
